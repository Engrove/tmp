using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using PresenceLock.App.Interop;
using PresenceLock.Core;

namespace PresenceLock.App.Sensors
{
    /// <summary>
    /// Reads passive OS state. Opens NO device, records nothing, needs no consent prompt.
    ///
    ///  DisplayRequired  CallNtPowerInformation(SystemExecutionState) &amp; ES_DISPLAY_REQUIRED.
    ///                   Documented, non-admin. Chromium (Chrome/Edge/WebView2) only holds its
    ///                   video wake lock while a video plays in a VISIBLE page (Blink
    ///                   VideoWakeLock::ShouldBeActive), so a minimised window or background tab
    ///                   does not count. UNVERIFIED: whether this aggregate includes other
    ///                   processes' PowerSetRequest() — check with --probe-signals. Disabled on
    ///                   server SKUs, where it is machine-wide across user sessions.
    ///
    ///  Mic / camera     HKCU ConsentStore\{microphone,webcam}: LastUsedTimeStart &gt; 0 and
    ///                   LastUsedTimeStop == 0. UNDOCUMENTED (widely used, not specified). A
    ///                   claim only counts if the owning process is ACTUALLY RUNNING (a crash can
    ///                   leave a stale 0) and the app is not on the policy ignore list
    ///                   (always-on mic tools would otherwise hold forever).
    ///
    /// Deliberately NOT used, with reasons:
    ///  * GSMTC PlaybackType: Chromium always reports MediaPlaybackType_Music, even for video,
    ///    so it cannot separate YouTube from Spotify.
    ///  * Per-process audio peaks: audio alone is not presence (music plays on during lunch).
    ///  * GPU VideoDecode counters: Chromium decodes in its GPU process (not the window owner),
    ///    engine naming is driver-specific (VIDEO_DECODE vs VIDEO_CODEC), no GPU in many VMs,
    ///    and a CAD animation is 3D work, not video decode.
    /// Any wrong or stuck signal can only delay a lock up to HoldMax + grace (coordinator backstop).
    /// </summary>
    internal sealed class PassiveSignalReader
    {
        private const string ConsentRoot = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";
        private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(5);

        public sealed class CapabilityUse
        {
            public string Capability;     // "microphone" / "webcam"
            public string App;            // exe path (NonPackaged) or package family name
            public bool Packaged;
            public bool ProcessRunning;   // liveness confirmed
            public bool Ignored;          // on the HoldIgnoreApps policy list
            public bool Counts => ProcessRunning && !Ignored;
        }

        private readonly string[] _ignore;
        private readonly int _ownPid;
        private DateTime _lastReadUtc = DateTime.MinValue;
        private PassiveSignals _cached;

        public bool PowerSignalAllowed { get; }

        public PassiveSignalReader(IEnumerable<string> ignoreApps)
        {
            _ignore = (ignoreApps ?? Enumerable.Empty<string>())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s.Trim())
                .Select(s => s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? s.Substring(0, s.Length - 4) : s)
                .ToArray();
            using (var me = Process.GetCurrentProcess()) _ownPid = me.Id;
            PowerSignalAllowed = IsWorkstationSku();
        }

        /// <summary>
        /// Cached read. Re-reads when the cache is older than 5 s OR older than the last user
        /// input, so the hold state is known at the start of every idle period, before the
        /// model can act on it.
        /// </summary>
        public PassiveSignals Read(DateTime lastInputUtc)
        {
            var now = DateTime.UtcNow;
            if (now - _lastReadUtc < CacheFor && _lastReadUtc >= lastInputUtc) return _cached;
            _cached = ReadNow(out _);
            _lastReadUtc = now;
            return _cached;
        }

        public PassiveSignals ReadNow(out List<CapabilityUse> claims)
        {
            claims = new List<CapabilityUse>();
            ProcessIndex procs = null;
            return new PassiveSignals
            {
                DisplayRequired = ReadDisplayRequired(),
                MicrophoneInUse = ReadCapability("microphone", claims, ref procs),
                CameraInUse = ReadCapability("webcam", claims, ref procs),
                InputDesktopObservable = NativeMethods.InputDesktopIsDefault()
            };
        }

        public bool? ReadDisplayRequired()
        {
            if (!PowerSignalAllowed) return null;
            try
            {
                uint status = NativeMethods.CallNtPowerInformation(
                    NativeMethods.SystemExecutionState, IntPtr.Zero, 0, out uint state, sizeof(uint));
                if (status != 0) return null;
                return (state & NativeMethods.ES_DISPLAY_REQUIRED) != 0;
            }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                return null;
            }
        }

        private bool? ReadCapability(string capability, List<CapabilityUse> claims, ref ProcessIndex procs)
        {
            try
            {
                using (var root = Registry.CurrentUser.OpenSubKey(ConsentRoot + capability, false))
                {
                    if (root == null) return null;                    // no ConsentStore: unavailable
                    bool any = false;
                    foreach (var name in root.GetSubKeyNames())
                    {
                        if (name.Equals("NonPackaged", StringComparison.OrdinalIgnoreCase))
                        {
                            using (var np = root.OpenSubKey(name, false))
                            {
                                if (np == null) continue;
                                foreach (var app in np.GetSubKeyNames())
                                    any |= Evaluate(np, app, capability, false, claims, ref procs);
                            }
                        }
                        else
                        {
                            any |= Evaluate(root, name, capability, true, claims, ref procs);
                        }
                    }
                    return any;
                }
            }
            catch (Exception ex) when (ex is System.Security.SecurityException ||
                                       ex is UnauthorizedAccessException || ex is IOException)
            {
                return null;
            }
        }

        private bool Evaluate(RegistryKey parent, string keyName, string capability, bool packaged,
                              List<CapabilityUse> claims, ref ProcessIndex procs)
        {
            long start = 0, stop = -1;
            using (var k = parent.OpenSubKey(keyName, false))
            {
                if (k == null) return false;
                if (k.GetValue("LastUsedTimeStart") is long a) start = a;
                if (k.GetValue("LastUsedTimeStop") is long b) stop = b;
            }
            if (!(start > 0 && stop == 0)) return false;              // not claimed as in use

            if (procs == null) procs = ProcessIndex.Snapshot(_ownPid);
            var use = new CapabilityUse
            {
                Capability = capability,
                Packaged = packaged,
                App = packaged ? keyName : keyName.Replace('#', '\\')
            };
            use.ProcessRunning = packaged ? procs.HasPackage(use.App) : procs.HasImage(use.App);
            use.Ignored = IsIgnored(use);
            claims.Add(use);
            return use.Counts;
        }

        private bool IsIgnored(CapabilityUse u)
        {
            string name;
            try { name = u.Packaged ? u.App : Path.GetFileNameWithoutExtension(u.App); }
            catch (ArgumentException) { name = u.App; }
            foreach (var i in _ignore)
            {
                if (u.Packaged ? u.App.StartsWith(i, StringComparison.OrdinalIgnoreCase)
                               : string.Equals(name, i, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        private static bool IsWorkstationSku()
        {
            try
            {
                var v = new NativeMethods.OSVERSIONINFOEXW
                {
                    dwOSVersionInfoSize = (uint)Marshal.SizeOf(typeof(NativeMethods.OSVERSIONINFOEXW))
                };
                return NativeMethods.RtlGetVersion(ref v) == 0 && v.wProductType == NativeMethods.VER_NT_WORKSTATION;
            }
            catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
            {
                return false;
            }
        }

        /// <summary>Image paths and package family names of running processes (built lazily, once per read).</summary>
        private sealed class ProcessIndex
        {
            private readonly HashSet<string> _images = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            private readonly HashSet<string> _packages = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            public static ProcessIndex Snapshot(int ownPid)
            {
                var idx = new ProcessIndex();
                var sb = new StringBuilder(1024);
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.Id == ownPid || p.Id == 0) continue;
                        IntPtr h = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, p.Id);
                        if (h == IntPtr.Zero) continue;                // other user / protected: skip
                        try
                        {
                            sb.Clear();
                            uint len = (uint)sb.Capacity;
                            if (NativeMethods.QueryFullProcessImageName(h, 0, sb, ref len)) idx._images.Add(sb.ToString());
                            sb.Clear();
                            uint plen = (uint)sb.Capacity;
                            if (NativeMethods.GetPackageFamilyName(h, ref plen, sb) == 0) idx._packages.Add(sb.ToString());
                        }
                        finally { NativeMethods.CloseHandle(h); }
                    }
                    finally { p.Dispose(); }
                }
                return idx;
            }

            public bool HasImage(string path) => _images.Contains(path);
            public bool HasPackage(string packageFamilyName) => _packages.Contains(packageFamilyName);
        }
    }
}
