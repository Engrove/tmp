using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using PresenceLock.Core;

namespace PresenceLock.App.Guard
{
    /// <summary>
    /// Win32 plumbing for the guard service (runs as LocalSystem in session 0): enumerate
    /// interactive sessions, start a process as the logged-on user inside a given session,
    /// lock a session, and resolve the user's SID and LocalAppData folder from their token.
    /// All APIs are documented; WTSQueryUserToken requires SE_TCB_NAME, which LocalSystem has.
    /// </summary>
    internal static class SessionLauncher
    {
        // ---------------------------------------------------------------- P/Invoke
        private static readonly IntPtr WTS_CURRENT_SERVER_HANDLE = IntPtr.Zero;

        private enum WTS_CONNECTSTATE_CLASS
        {
            WTSActive, WTSConnected, WTSConnectQuery, WTSShadow, WTSDisconnected,
            WTSIdle, WTSListen, WTSReset, WTSDown, WTSInit
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WTS_SESSION_INFO
        {
            public int SessionId;
            [MarshalAs(UnmanagedType.LPWStr)] public string pWinStationName;
            public WTS_CONNECTSTATE_CLASS State;
        }

        [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version,
            out IntPtr sessionInfo, out int count);

        [DllImport("wtsapi32.dll")]
        private static extern void WTSFreeMemory(IntPtr memory);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSQuerySessionInformation(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);
        private const int WTSSessionInfoEx = 25;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
        private const uint WAIT_OBJECT_0 = 0;

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSQueryUserToken(int sessionId, out IntPtr token);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSDisconnectSession(IntPtr server, int sessionId, [MarshalAs(UnmanagedType.Bool)] bool wait);

        private const uint MAXIMUM_ALLOWED = 0x02000000;
        private const int SecurityImpersonation = 2;
        private const int TokenPrimary = 1;

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DuplicateTokenEx(IntPtr existing, uint access, IntPtr attributes,
            int impersonationLevel, int tokenType, out IntPtr newToken);

        [DllImport("userenv.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token,
            [MarshalAs(UnmanagedType.Bool)] bool inherit);

        [DllImport("userenv.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DestroyEnvironmentBlock(IntPtr environment);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess, hThread;
            public int dwProcessId, dwThreadId;
        }

        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessAsUser(IntPtr token, string applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags, IntPtr environment, string currentDirectory,
            ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("shell32.dll")]
        private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid folderId,
            uint flags, IntPtr token, out IntPtr path);

        private static readonly Guid FOLDERID_LocalAppData = new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091");

        // ---------------------------------------------------------------- API

        public static readonly string AgentExePath = ResolveOwnPath();

        private static string ResolveOwnPath()
        {
            using (var me = Process.GetCurrentProcess()) return me.MainModule.FileName;
        }

        private static string ImagePath(int pid)
        {
            IntPtr h = Interop.NativeMethods.OpenProcess(Interop.NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                uint len = (uint)sb.Capacity;
                return Interop.NativeMethods.QueryFullProcessImageName(h, 0, sb, ref len) ? sb.ToString() : null;
            }
            finally { CloseHandle(h); }
        }

        /// <summary>
        /// All sessions, with whether a GENUINE agent runs in each. A process only counts if its
        /// full image path is the installed exe: a user-started copy renamed "PresenceLock.exe"
        /// in some writable folder must not satisfy the guard.
        /// </summary>
        public static List<SessionSnapshot> Snapshot()
        {
            var result = new List<SessionSnapshot>();
            var agentSessions = new HashSet<int>();
            int ownPid;
            using (var me = Process.GetCurrentProcess()) ownPid = me.Id;
            foreach (var p in Process.GetProcessesByName("PresenceLock"))
            {
                try
                {
                    // Exact installed image AND the agent role (no arguments): a CLI instance of the
                    // same exe (--probe-signals, --status ...) does not protect anything (review F04).
                    if (p.Id != ownPid &&
                        string.Equals(ImagePath(p.Id), AgentExePath, StringComparison.OrdinalIgnoreCase) &&
                        Interop.ProcessInfo.IsAgentRole(Interop.ProcessInfo.TryGetCommandLine(p.Id)))
                        agentSessions.Add(p.SessionId);
                }
                catch (Exception) { /* process ended meanwhile */ }
                finally { p.Dispose(); }
            }

            if (!WTSEnumerateSessions(WTS_CURRENT_SERVER_HANDLE, 0, 1, out IntPtr buffer, out int count))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
                for (int i = 0; i < count; i++)
                {
                    var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(buffer + i * size);
                    bool active = info.State == WTS_CONNECTSTATE_CLASS.WTSActive;
                    result.Add(new SessionSnapshot
                    {
                        SessionId = info.SessionId,
                        Active = active,
                        AgentRunning = agentSessions.Contains(info.SessionId),
                        HeartbeatAgeSeconds = active && info.SessionId != 0 ? HeartbeatAge(info.SessionId) : double.NaN,
                        Locked = active && info.SessionId != 0 ? QueryLocked(info.SessionId) : null
                    });
                }
            }
            finally { WTSFreeMemory(buffer); }
            return result;
        }

        /// <summary>Start PresenceLock.exe [arguments] as the session's user, on its interactive desktop.</summary>
        public static void StartInSession(int sessionId, string arguments) => CloseHandle(StartInSessionHandle(sessionId, arguments));

        private static IntPtr StartInSessionHandle(int sessionId, string arguments)
        {
            IntPtr userToken = IntPtr.Zero, primary = IntPtr.Zero, env = IntPtr.Zero;
            try
            {
                if (!WTSQueryUserToken(sessionId, out userToken))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken");
                if (!DuplicateTokenEx(userToken, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out primary))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "DuplicateTokenEx");
                if (!CreateEnvironmentBlock(out env, primary, false))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateEnvironmentBlock");

                string exe = AgentExePath;
                var cmd = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(arguments) ? "" : " " + arguments));
                var si = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), lpDesktop = @"winsta0\default" };
                if (!CreateProcessAsUser(primary, exe, cmd, IntPtr.Zero, IntPtr.Zero, false,
                        CREATE_UNICODE_ENVIRONMENT, env, System.IO.Path.GetDirectoryName(exe), ref si, out var pi))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser");
                CloseHandle(pi.hThread);
                return pi.hProcess;
            }
            finally
            {
                if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
                if (primary != IntPtr.Zero) CloseHandle(primary);
                if (userToken != IntPtr.Zero) CloseHandle(userToken);
            }
        }

        /// <summary>
        /// REQUEST a session lock: run "PresenceLock.exe --lock-now" as its user and wait (bounded)
        /// for its exit code, which is 0 only if LockWorkStation returned TRUE. That still only means
        /// the lock was INITIATED (LockWorkStation is asynchronous): the guard counts the session as
        /// locked only when Windows reports it (session-change event or <see cref="QueryLocked"/>).
        /// </summary>
        public static bool RequestLock(int sessionId, out string detail)
        {
            try
            {
                uint code = RunInSessionAndWait(sessionId, "--lock-now", 5000, out bool exited);
                detail = !exited ? "lock helper did not finish within 5 s" : code == 0 ? "LockWorkStation initiated" : "LockWorkStation refused (exit " + code + ")";
                return exited && code == 0;
            }
            catch (Win32Exception ex)
            {
                detail = "lock helper could not be started: " + ex.Message;
                return false;
            }
        }

        /// <summary>Fallback: disconnect the session (reconnecting requires authentication).</summary>
        public static bool RequestDisconnect(int sessionId, out string detail)
        {
            bool ok = WTSDisconnectSession(WTS_CURRENT_SERVER_HANDLE, sessionId, false);
            detail = ok ? "disconnect initiated" : "disconnect failed, error " + Marshal.GetLastWin32Error();
            return ok;
        }

        /// <summary>
        /// The session's lock state from WTSSessionInfoEx (WTSINFOEX_LEVEL1.SessionFlags:
        /// 0 = locked, 1 = unlocked; the documented inversion only affects Windows 7 / 2008 R2,
        /// outside this product's scope). null if it cannot be read. Pilot item: verify on the target build.
        /// </summary>
        public static bool? QueryLocked(int sessionId)
        {
            if (!WTSQuerySessionInformation(WTS_CURRENT_SERVER_HANDLE, sessionId, WTSSessionInfoEx, out IntPtr buf, out int bytes))
                return null;
            try
            {
                if (bytes < 20 || Marshal.ReadInt32(buf, 0) != 1) return null;     // Level must be 1
                int flags = Marshal.ReadInt32(buf, 16);                             // Data (8-aligned) + SessionId + SessionState
                if (flags == 0) return true;
                if (flags == 1) return false;
                return null;
            }
            finally { WTSFreeMemory(buf); }
        }

        /// <summary>Seconds since the agent's heartbeat in the session user's hive; NaN if none.</summary>
        public static double HeartbeatAge(int sessionId)
        {
            try
            {
                if (!TryGetUser(sessionId, out string sid, out _)) return double.NaN;
                using (var k = Microsoft.Win32.Registry.Users.OpenSubKey(sid + @"\" + AgentHeartbeat.KeyPath, false))
                {
                    if (!(k?.GetValue(AgentHeartbeat.ValueName) is long ticks)) return double.NaN;
                    return Math.Max(0, (DateTime.UtcNow.Ticks - ticks) / (double)TimeSpan.TicksPerSecond);
                }
            }
            catch (Exception) { return double.NaN; }
        }

        private static uint RunInSessionAndWait(int sessionId, string arguments, uint timeoutMs, out bool exited)
        {
            IntPtr process = StartInSessionHandle(sessionId, arguments);
            try
            {
                exited = WaitForSingleObject(process, timeoutMs) == WAIT_OBJECT_0;
                return exited && GetExitCodeProcess(process, out uint code) ? code : uint.MaxValue;
            }
            finally { CloseHandle(process); }
        }

        /// <summary>
        /// Run code with the session user's own rights (impersonation). The guard reads files in the
        /// user's writable profile this way, so a junction or symlink there can only lead to files the
        /// user could read anyway (review F26).
        /// </summary>
        public static T AsSessionUser<T>(int sessionId, Func<T> action)
        {
            if (!WTSQueryUserToken(sessionId, out IntPtr token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken");
            using (var handle = new Microsoft.Win32.SafeHandles.SafeAccessTokenHandle(token))
                return WindowsIdentity.RunImpersonated(handle, action);
        }

        /// <summary>The session user's SID and LocalAppData folder (from their own token).</summary>
        public static bool TryGetUser(int sessionId, out string sid, out string localAppData)
        {
            sid = null; localAppData = null;
            if (!WTSQueryUserToken(sessionId, out IntPtr token)) return false;
            try
            {
                using (var id = new WindowsIdentity(token)) sid = id.User?.Value;
                if (SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, token, out IntPtr p) == 0)
                {
                    localAppData = Marshal.PtrToStringUni(p);
                    Marshal.FreeCoTaskMem(p);
                }
                return sid != null && localAppData != null;
            }
            finally { CloseHandle(token); }
        }
    }
}
