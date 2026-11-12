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
                        Console.WriteLine("habits: probes " + st.HabitProbes + " (answered " + st.HabitProbesAnswered + ", locked " + st.HabitLocks +
                                          ", quick unlocks " + st.HabitQuickUnlocks + "); RDP/console disconnects " + st.Disconnects);
                        Console.WriteLine("learned horizon: certain-absence confirmation between 180 s and the cap " +
                                          "(policy LearnedHorizon), per context where the model expects absence");
                        long nowTicks = DateTime.UtcNow.Ticks;
                        if (p.Silence != null)
                            for (int c = 0; c < SilenceProfile.Contexts; c++)
                                Console.WriteLine("silence profile " + p.Silence.Fit(c, nowTicks).Describe());
                        if (p.Guard != null) Console.WriteLine(p.Guard.Describe());
                        if (p.Quality != null) Console.WriteLine(p.Quality.Describe(p.Modes));
                        Console.WriteLine("ambiguous learning decisions: judged away " + st.AmbiguousScoredAway +
                                          ", undecidable " + st.AmbiguousScoredUnknown);
                        if (p.Pause != null)
                        {
                            var pp = Settings.PolicyReader.Load().ToCoordinatorConfig().Pause;
                            long nowT = DateTime.UtcNow.Ticks;
                            Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                                "user pause: {0}; options {1} min; charged in the last 24 h {2:F0} of {3} min; {4}; pauses so far {5} ({6:F0} min charged)",
                                pp.Enabled && pp.BudgetMinutesPer24h > 0 ? "allowed" : "not allowed",
                                string.Join("/", pp.ValidOptions()), p.Pause.ChargedMinutes(nowT), pp.BudgetMinutesPer24h,
                                p.Pause.IsActive(nowT) ? "PAUSED until " + new DateTime(p.Pause.ActiveUntil(nowT), DateTimeKind.Utc).ToString("u") : "not paused",
                                p.Pause.PausesStarted, p.Pause.MinutesChargedTotal));
                        }
                        Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                            "cleaning service: {0} runs, last {1}; retired so far: {2} journal episodes, {3} log lines, {4} files; backup {5}",
                            st.HousekeepingRuns,
                            st.LastHousekeepingUtcTicks == 0 ? "never" : new DateTime(st.LastHousekeepingUtcTicks, DateTimeKind.Utc).ToString("u"),
                            st.JournalEpisodesRetired, st.LogLinesRetired, st.FilesRetired,
                            File.Exists(path + Housekeeping.BackupSuffix) ? File.GetLastWriteTimeUtc(path + Housekeeping.BackupSuffix).ToString("u") : "none"));
                        string me = System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value ?? "";
                        if (File.Exists(HabitStore.DefaultPath()))
                        {
                            var j = HabitStore.LoadOrCreate(HabitStore.DefaultPath(), me);
                            var hp = new HabitPolicy();
                            bool earned = HabitModel.Earned(j, hp, out int n, out double prec, out double lo);
                            var t = HabitModel.BuildActivityTable(j, DateTime.UtcNow.Ticks, hp);
                            Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                                "habit journal: {0} episodes over {1:F0} days; scored verdicts {2}, precision {3:P0} " +
                                "(Wilson lower {4:P0}, needs >= {5:P0} and n >= {6}); Brier {7}; habits {8}",
                                j.Episodes.Count, t.SpanDays, n, prec, lo, hp.MinPrecisionLower95, hp.MinScoredVerdicts,
                                HabitModel.Brier(j)?.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "-",
                                earned ? "ACTIVE" : "shadow only"));
                        }
                        else Console.WriteLine("habit journal: none (habit learning off or no data yet)");
                        return 0;
                    }
                    case "--about":
                    {
                        string v = typeof(Cli).Assembly.GetName().Version.ToString(3);
                        Console.WriteLine(AboutContent.AsText(AboutContent.Build(Settings.PolicyReader.Load().ToAboutInfo(v))));
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
                        int maxAge = Settings.PolicyReader.Load().CollectedProfileRetentionDays;
                        for (int i = 2; i < args.Length; i++)
                        {
                            var p = ProfileStore.Deserialize(BoundedFile.ReadAllText(args[i], BoundedFile.MaxProfileBytes));
                            double age = (DateTime.UtcNow.Ticks - p.UpdatedUtcTicks) / (double)TimeSpan.TicksPerDay;
                            if (age > maxAge) { Console.WriteLine("skipped (older than " + maxAge + " days): " + args[i]); continue; }
                            inputs.Add(p);
                        }
                        File.WriteAllText(args[1], ProfileStore.Serialize(ProfileStore.MergeBaseline(inputs)));
                        Console.WriteLine("merged " + inputs.Count + " profiles into " + args[1]);
                        return 0;
                    }
                    case "--lock-now":
                        // Used by the guard service (fail-closed); harmless for anyone else.
                        return Interop.NativeMethods.LockWorkStation() ? 0 : 1;

                    case "--reset-profile":
                        return ResetProfile(path, args.Length > 1 ? args[1] : null);
                    default:
                        Console.WriteLine("usage: PresenceLock.exe [--status | --about | --export f | --export-baseline f | " +
                                          "--merge-baseline out in1 in2 ... | --reset-profile [SID] | " +
                                          "--probe-signals [s] | --lock-now]");
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
            Console.WriteLine("remote session: " + Interop.NativeMethods.IsRemoteSession());
            Console.WriteLine("time      idle  DisplayRequired  mic    camera  inputDesktop  -> hold");
            for (int i = 0; i < seconds; i++)
            {
                var s = reader.ReadNow(out var claims);
                Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "{0:HH:mm:ss} {1,5:F0}  {2,-15}  {3,-5}  {4,-6}  {5,-12}  -> {6}",
                    DateTime.Now, Interop.NativeMethods.IdleSeconds(),
                    Show(s.DisplayRequired), Show(s.MicrophoneInUse), Show(s.CameraInUse),
                    Show(s.InputDesktopObservable), coordinatorProbe.EvaluateHold(s)));
                foreach (var c in claims)
                    Console.WriteLine("            claim {0}: {1}  running={2} ignored={3}",
                        c.Capability, c.App, c.ProcessRunning, c.Ignored);
                System.Threading.Thread.Sleep(1000);
            }
            return 0;
        }

        private static string Show(bool? v) => v.HasValue ? v.Value.ToString() : "n/a";

        private static bool IsElevatedAdmin()
        {
            using (var id = System.Security.Principal.WindowsIdentity.GetCurrent())
                return new System.Security.Principal.WindowsPrincipal(id)
                    .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }

        /// <summary>
        /// Resetting a profile restarts the learning period (no locking for 15+ days), so in NIS2
        /// mode (AllowUserExit = 0) only an elevated administrator may do it. With a SID, an
        /// administrator resets that user's local and protected profile; do it while the user is
        /// logged off, otherwise their running agent writes its in-memory profile back.
        /// </summary>
        private static int ResetProfile(string ownPath, string targetSid)
        {
            bool admin = IsElevatedAdmin();
            if (!Settings.PolicyReader.Load().AllowUserExit && !admin)
            {
                Console.WriteLine("refused: policy AllowUserExit = 0 — only an elevated administrator may reset a profile");
                return 1;
            }
            if (targetSid == null)
            {
                if (File.Exists(ownPath)) File.Delete(ownPath);
                if (File.Exists(HabitStore.DefaultPath())) File.Delete(HabitStore.DefaultPath());
                string me = System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value;
                if (admin && me != null) Guard.ProtectedStore.Delete(me);
                Console.WriteLine("profile removed; it is recreated (learning mode) at next agent start");
                return 0;
            }
            if (!admin)
            {
                Console.WriteLine("refused: resetting another user's profile requires an elevated administrator");
                return 1;
            }
            using (var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                       @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\" + targetSid, false))
            {
                string home = k?.GetValue("ProfileImagePath") as string;
                if (home != null)
                {
                    string dir = Path.Combine(Environment.ExpandEnvironmentVariables(home), @"AppData\Local\PresenceLock");
                    foreach (var name in new[] { "profile.json", "habits.json" })
                    {
                        string p = Path.Combine(dir, name);
                        if (File.Exists(p)) File.Delete(p);
                    }
                }
            }
            Guard.ProtectedStore.Delete(targetSid);
            Console.WriteLine("profile of " + targetSid + " removed (local and protected copy)");
            return 0;
        }

        private static UserProfile Load(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("no profile for this user yet", path);
            return ProfileStore.Deserialize(BoundedFile.ReadAllText(path, BoundedFile.MaxProfileBytes));
        }

        private static void Need(string[] args, int n)
        {
            if (args.Length < n) throw new ArgumentException("missing argument(s) for " + args[0]);
        }
    }
}
