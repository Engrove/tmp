using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using PresenceLock.Core;

namespace PresenceLock.App
{
    /// <summary>
    /// Administrative command line (run as the user whose profile you want, e.g. from a
    /// logon script or remote shell). Output goes to the calling console.
    ///
    ///   PresenceLock.exe --status
    ///   PresenceLock.exe --export &lt;file.json&gt;
    ///   PresenceLock.exe --export-baseline &lt;file.json&gt;
    ///   PresenceLock.exe --merge-baseline &lt;out.json&gt; &lt;in1.json&gt; &lt;in2.json&gt; ...
    ///   PresenceLock.exe --reset-profile
    ///   PresenceLock.exe --probe-signals [seconds]   live view of passive OS signals (verification)
    ///
    /// The running agent saves every 5 minutes and on lock/logoff, so the on-disk profile
    /// read here can be up to 5 minutes behind the agent's memory.
    /// </summary>
    internal static class Cli
    {
        [DllImport("kernel32.dll")]
        private static extern bool AttachConsole(int dwProcessId);
        private const int ATTACH_PARENT_PROCESS = -1;

        public static int Run(string[] args)
        {
            AttachConsole(ATTACH_PARENT_PROCESS); // WinExe: borrow the caller's console if any
            Console.WriteLine();
            try
            {
                string path = ProfileStore.DefaultPath();
                switch (args[0].ToLowerInvariant())
                {
                    case "--status":
                    {
                        var p = Load(path);
                        Console.WriteLine("profile: " + path);
                        Console.WriteLine(p.Modes.Explain(DateTime.UtcNow.Ticks));
                        if (p.Modes.PromotedUtcTicks != 0)
                            Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                                "promoted {0:u} (window {1:P1}, upper95 {2:P1}{3})",
                                new DateTime(p.Modes.PromotedUtcTicks, DateTimeKind.Utc),
                                p.Modes.PromotionWindowRate, p.Modes.PromotionUpperBound,
                                p.Modes.PromotionForcedByPolicy ? ", forced by policy" : ""));
                        var reading = new double[FeatureSchema.Count]; reading[FeatureSchema.CtxReading] = 1;
                        var neutral = new double[FeatureSchema.Count];
                        var postHold = new double[FeatureSchema.Count]; postHold[FeatureSchema.PostHold] = 1;
                        Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                            "lock time t(90%): neutral {0:F0} s, reading-app context {1:F0} s, after media/meeting {2:F0} s",
                            p.Model.LockTime(neutral, p.Config.LockThreshold),
                            p.Model.LockTime(reading, p.Config.LockThreshold),
                            p.Model.LockTime(postHold, p.Config.LockThreshold)));
                        var st = p.Stats;
                        Console.WriteLine("passive hold: starts " + st.HoldStarts + ", discarded model episodes " + st.HoldAbortedEpisodes +
                                          ", probes " + st.HoldProbes + " (answered " + st.HoldProbesAnswered + ", locked " + st.HoldProbeLocks +
                                          ", quick unlocks " + st.HoldProbeQuickUnlocks + ")");
                        Console.WriteLine("backstop: dims " + st.BackstopDims + " (answered " + st.BackstopAnswered + ", locked " + st.BackstopLocks +
                                          ", quick unlocks " + st.BackstopQuickUnlocks + ")");
                        return 0;
                    }
                    case "--probe-signals":
                        return ProbeSignals(args.Length > 1 && int.TryParse(args[1], out int secs) ? secs : 60);
                    case "--export":
                        Need(args, 2);
                        File.WriteAllText(args[1], ProfileStore.Serialize(Load(path)));
                        Console.WriteLine("exported " + args[1]);
                        return 0;
                    case "--export-baseline":
                        Need(args, 2);
                        File.WriteAllText(args[1], ProfileStore.Serialize(ProfileStore.ExportBaseline(Load(path))));
                        Console.WriteLine("exported anonymised baseline " + args[1]);
                        return 0;
                    case "--merge-baseline":
                    {
                        Need(args, 3);
                        var inputs = new List<UserProfile>();
                        for (int i = 2; i < args.Length; i++)
                            inputs.Add(ProfileStore.Deserialize(File.ReadAllText(args[i])));
                        File.WriteAllText(args[1], ProfileStore.Serialize(ProfileStore.MergeBaseline(inputs)));
                        Console.WriteLine("merged " + inputs.Count + " profiles into " + args[1]);
                        return 0;
                    }
                    case "--reset-profile":
                        if (File.Exists(path)) File.Delete(path);
                        Console.WriteLine("profile removed; it is recreated (learning mode) at next agent start");
                        return 0;
                    default:
                        Console.WriteLine("usage: PresenceLock.exe [--status | --export f | --export-baseline f | " +
                                          "--merge-baseline out in1 in2 ... | --reset-profile]");
                        return 2;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("error: " + ex.Message);
                return 1;
            }
        }

        /// <summary>
        /// Live verification of the passive signals on THIS machine. Suggested checks:
        ///   play a YouTube video (visible)  -> DisplayRequired should be True
        ///   minimise it / switch tab        -> False within a few seconds
        ///   join a Teams/Zoom call           -> mic in use, process running = True
        ///   leave the call                   -> no claim
        /// No device is opened; nothing is written.
        /// </summary>
        private static int ProbeSignals(int seconds)
        {
            var settings = Settings.PolicyReader.Load();
            var reader = new Sensors.PassiveSignalReader(settings.HoldIgnoreApps);
            var coordinatorProbe = new PresenceCoordinator(new PresenceEngine(new UserProfile()), settings.ToCoordinatorConfig());
            Console.WriteLine("power signal: " + (reader.PowerSignalAllowed ? "enabled (workstation SKU)" : "disabled (server SKU)"));
            Console.WriteLine("time      idle  DisplayRequired  mic    camera  -> hold");
            for (int i = 0; i < seconds; i++)
            {
                var s = reader.ReadNow(out var claims);
                Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "{0:HH:mm:ss} {1,5:F0}  {2,-15}  {3,-5}  {4,-6}  -> {5}",
                    DateTime.Now, Interop.NativeMethods.IdleSeconds(),
                    Show(s.DisplayRequired), Show(s.MicrophoneInUse), Show(s.CameraInUse),
                    coordinatorProbe.EvaluateHold(s)));
                foreach (var c in claims)
                    Console.WriteLine("            claim {0}: {1}  running={2} ignored={3}",
                        c.Capability, c.App, c.ProcessRunning, c.Ignored);
                System.Threading.Thread.Sleep(1000);
            }
            return 0;
        }

        private static string Show(bool? v) => v.HasValue ? v.Value.ToString() : "n/a";

        private static UserProfile Load(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("no profile for this user yet", path);
            return ProfileStore.Deserialize(File.ReadAllText(path));
        }

        private static void Need(string[] args, int n)
        {
            if (args.Length < n) throw new ArgumentException("missing argument(s) for " + args[0]);
        }
    }
}
