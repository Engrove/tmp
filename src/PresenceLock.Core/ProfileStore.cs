using System;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;

namespace PresenceLock.Core
{
    /// <summary>
    /// Load / save / export of the per-user profile as JSON. Uses the in-box
    /// DataContractJsonSerializer so the shipping app needs zero third-party DLLs
    /// (important for a clean GPO deployment with no extra install requirements).
    /// </summary>
    public static class ProfileStore
    {
        public static string DefaultDirectory()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(appData, "PresenceLock");
        }

        public static string DefaultPath() => Path.Combine(DefaultDirectory(), "profile.json");

        private static readonly DataContractJsonSerializer Serializer =
            new DataContractJsonSerializer(typeof(UserProfile));

        public static string Serialize(UserProfile profile)
        {
            using (var ms = new MemoryStream())
            {
                Serializer.WriteObject(ms, profile);
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        public static UserProfile Deserialize(string json)
        {
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                var p = (UserProfile)Serializer.ReadObject(ms);
                return Normalize(p);
            }
        }

        /// <summary>
        /// Load the profile for the current user, or create a fresh one. A schema/shape
        /// mismatch is treated as "start over" rather than crashing: a corrupt or
        /// incompatible profile must never take the agent down.
        /// </summary>
        public static UserProfile LoadOrCreate(string path, string userSid, string machineName) =>
            LoadWithRecovery(path, userSid, machineName, out _);

        /// <summary>
        /// Self-healing load. Order: the profile; if it is unreadable, oversized or not current, the
        /// last-known-good backup written by the daily housekeeping; only then a fresh profile.
        /// <paramref name="recovery"/> is null on a normal load, otherwise what happened (for the
        /// event log: an administrator should know, but must not be NEEDED to fix it).
        /// </summary>
        /// <param name="processStartUtcTicks">start of the calling process: agent files written before it
        /// show that this folder was in use already (0 = unknown).</param>
        public static UserProfile LoadWithRecovery(string path, string userSid, string machineName, out string recovery,
                                                   long processStartUtcTicks = 0)
        {
            recovery = null;
            string bak = path + Housekeeping.BackupSuffix;
            string problem;
            UserProfile p;
            if (!File.Exists(path))
            {
                // A missing profile is treated like a broken one: if a good backup exists, the
                // profile was lost (deleted, roaming hiccup), not never created.
                if (!File.Exists(bak))
                {
                    if (!FolderUsedBefore(path, processStartUtcTicks)) return Fresh(userSid, machineName, "first start");
                    recovery = "profile.json missing although the agent folder was in use before (deleted or lost); no backup, started a fresh profile";
                    return Fresh(userSid, machineName, "recreated: profile.json was missing although the agent folder was in use before (deleted or lost); no backup");
                }
                problem = "missing";
            }
            else
            {
                problem = TryLoad(path, out p);
                if (problem == null) return p;
            }
            if (File.Exists(bak) && TryLoad(bak, out var b) == null
                && (string.IsNullOrEmpty(userSid) || string.IsNullOrEmpty(b.UserSid) || string.Equals(b.UserSid, userSid, StringComparison.OrdinalIgnoreCase)))
            {
                recovery = "profile.json " + problem + "; restored from the last-known-good backup of " +
                           File.GetLastWriteTimeUtc(bak).ToString("u");
                return b;
            }
            recovery = "profile.json " + problem + "; no usable backup, started a fresh profile";
            return Fresh(userSid, machineName, "recreated: profile.json " + problem + "; no usable backup");
        }

        /// <summary>
        /// Evidence that this agent folder held a profile before: the habit journal, a rotated log, or a
        /// log written before this process started. (A deleted profile otherwise looks like a first start.)
        /// </summary>
        private static bool FolderUsedBefore(string profilePath, long processStartUtcTicks)
        {
            try
            {
                string dir = Path.GetDirectoryName(profilePath) ?? "";
                if (File.Exists(Path.Combine(dir, "habits.json")) || File.Exists(Path.Combine(dir, "agent.log.1"))) return true;
                string log = Path.Combine(dir, "agent.log");
                return processStartUtcTicks > 0 && File.Exists(log) && File.GetLastWriteTimeUtc(log).Ticks < processStartUtcTicks;
            }
            catch { return false; }
        }

        private static string TryLoad(string path, out UserProfile p)
        {
            p = null;
            try
            {
                p = Deserialize(BoundedFile.ReadAllText(path, BoundedFile.MaxProfileBytes));   // migrates older schemas
                if (p == null) return "empty";
                if (p.SchemaVersion != UserProfile.CurrentSchemaVersion) return "written by a newer version";
                return null;
            }
            catch (InvalidDataException ex) { return "oversized (" + ex.Message + ")"; }
            catch (Exception ex) { return "unreadable (" + ex.GetType().Name + ")"; }
        }

        private static UserProfile Fresh(string userSid, string machineName, string origin) =>
            new UserProfile { UserSid = userSid ?? "", MachineName = machineName ?? "", Origin = origin };

        public static void Save(string path, UserProfile profile)
        {
            profile.UpdatedUtcTicks = DateTime.UtcNow.Ticks;
            WriteText(path, Serialize(profile));
        }

        /// <summary>
        /// Atomic-ish write of already serialised text: temp file (unique name) then replace, so a
        /// crash mid-write cannot corrupt the live file. Used by the agent's background writer.
        /// </summary>
        public static void WriteText(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string tmp = TempName(path);
            try
            {
                File.WriteAllText(tmp, text, new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(tmp, path, null);
                else File.Move(tmp, path);
            }
            finally { if (File.Exists(tmp)) File.Delete(tmp); }
        }

        /// <summary>
        /// A temporary name unique to this process and write, so two sessions of the same user (RDS)
        /// or two overlapping saves never write the same .tmp file. Leftovers are removed by the
        /// cleaning service (*.tmp older than an hour).
        /// </summary>
        public static string TempName(string path) =>
            path + "." + System.Diagnostics.Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture)
                 + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";

        /// <summary>
        /// What the daily collection to ProfileExportDirectory contains: what --merge-baseline and
        /// an administrator's review need (weights, gate state, counters), and nothing that tells
        /// WHEN the user did something. Removed: pause start/end times, the silence profile, the
        /// unattended-time values of recent locks and the guard's last-rollback time. The habit
        /// journal is a separate file and never collected.
        /// </summary>
        public static UserProfile ExportForCollection(UserProfile profile)
        {
            var clone = Deserialize(Serialize(profile));
            // Identity and life-cycle times are not needed to build a baseline. The FILE NAME
            // (COMPUTER_USER.json) still identifies the user: that is documented, not hidden.
            clone.UserSid = "";
            clone.MachineName = "";
            clone.CreatedUtcTicks = 0;
            clone.UpdatedUtcTicks = profile.UpdatedUtcTicks - profile.UpdatedUtcTicks % TimeSpan.TicksPerDay;   // day only: age filter of --merge-baseline
            clone.Modes.FirstSeenUtcTicks = 0;
            clone.Modes.PromotedUtcTicks = 0;
            clone.Modes.DayWindow = new int[ModeController.WindowSize];   // dates of decision opportunities = activity days
            clone.Pause = new PauseLedger { PausesStarted = profile.Pause?.PausesStarted ?? 0, MinutesChargedTotal = profile.Pause?.MinutesChargedTotal ?? 0 };
            clone.Silence = new SilenceProfile();
            clone.Quality = new QualityMonitor { Degraded = profile.Quality?.Degraded ?? false, Alerts = profile.Quality?.Alerts ?? 0 };
            if (clone.Guard != null) clone.Guard.LastRollbackUtcTicks = 0;
            clone.Stats.LastHousekeepingUtcTicks = 0;
            return clone;
        }

        /// <summary>
        /// Produce an anonymised baseline for fleet seeding: keep the learned weights
        /// and hyper-parameters, but drop the user identity and reset the per-user
        /// calibration so the recipient machine re-earns its own promotion to enforcing
        /// mode rather than inheriting someone else's "safe" verdict.
        /// </summary>
        public static UserProfile ExportBaseline(UserProfile profile)
        {
            var clone = Deserialize(Serialize(profile)); // deep copy via round-trip
            clone.UserSid = "";
            clone.MachineName = "";
            clone.CreatedUtcTicks = DateTime.UtcNow.Ticks;
            clone.UpdatedUtcTicks = clone.CreatedUtcTicks;

            clone.Modes.ResetCalibration();
            clone.Origin = "seeded from baseline";
            clone.Stats = new CoordinatorStats();
            clone.Silence = new SilenceProfile();          // personal rhythm: never part of a baseline
            clone.Guard = new ModelGuard();
            clone.Quality = new QualityMonitor();
            clone.Pause = new PauseLedger();

            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                clone.OptionalSeen[i] = 0;
                clone.OptionalAvailable[i] = 0;
            }
            return clone;
        }

        /// <summary>
        /// Fleet baseline: element-wise mean of the learned parameters of several exported
        /// profiles, hyper-parameters/config taken from the first, calibration reset (via
        /// <see cref="ExportBaseline"/>). Averaging logistic models is NOT equivalent to
        /// training on the pooled data; it is a reasonable starting prior, and every machine
        /// that receives it still has to earn enforcing mode through its own learning window.
        /// </summary>
        public static UserProfile MergeBaseline(System.Collections.Generic.IList<UserProfile> profiles)
        {
            if (profiles == null || profiles.Count == 0)
                throw new ArgumentException("at least one profile is required", nameof(profiles));

            var merged = Deserialize(Serialize(profiles[0])); // deep copy carries config/hparams
            int n = profiles.Count;
            double w0 = 0, u0 = 0;
            var w = new double[FeatureSchema.Count];
            var u = new double[FeatureSchema.Count];
            foreach (var p in profiles)
            {
                w0 += p.Model.W0; u0 += p.Model.U0;
                for (int i = 0; i < FeatureSchema.Count; i++) { w[i] += p.Model.W[i]; u[i] += p.Model.U[i]; }
            }
            merged.Model.W0 = w0 / n;
            merged.Model.U0 = u0 / n;
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                merged.Model.W[i] = w[i] / n;
                merged.Model.U[i] = u[i] / n;
            }
            return ExportBaseline(merged);
        }

        private static UserProfile Normalize(UserProfile p)
        {
            if (p == null) return new UserProfile();
            if (p.Model == null) p.Model = new PresenceModel();
            if (p.Modes == null) p.Modes = new ModeController();
            p.Modes.Normalize();
            if (p.Config == null) p.Config = new EngineConfig();
            if (p.Stats == null) p.Stats = new CoordinatorStats();
            if (p.Stats.EpisodesByContext == null || p.Stats.EpisodesByContext.Length != SilenceProfile.Contexts)
                p.Stats.EpisodesByContext = new int[SilenceProfile.Contexts];
            if (p.Origin == null) p.Origin = "";
            if (p.Silence == null) p.Silence = new SilenceProfile();
            p.Silence.Normalize();
            if (p.Guard == null) p.Guard = new ModelGuard();
            p.Guard.Normalize();
            if (p.Quality == null) p.Quality = new QualityMonitor();
            p.Quality.Normalize();
            if (p.Pause == null) p.Pause = new PauseLedger();
            p.Pause.Normalize();

            // A profile written by a NEWER agent cannot be interpreted safely: start over
            // (LoadOrCreate sees the version mismatch) rather than guess.
            if (p.SchemaVersion > UserProfile.CurrentSchemaVersion) return p;

            // Schema migration (append-only feature layout): keep every learned weight and
            // counter, give new features weight 0 = "no opinion yet".
            p.Model.W = Pad(p.Model.W);
            p.Model.U = Pad(p.Model.U);
            p.OptionalSeen = Pad(p.OptionalSeen);
            p.OptionalAvailable = Pad(p.OptionalAvailable);
            p.SchemaVersion = UserProfile.CurrentSchemaVersion;
            return p;
        }

        private static double[] Pad(double[] a)
        {
            if (a != null && a.Length == FeatureSchema.Count) return a;
            var r = new double[FeatureSchema.Count];
            if (a != null) Array.Copy(a, r, Math.Min(a.Length, r.Length));
            return r;
        }

        private static int[] Pad(int[] a)
        {
            if (a != null && a.Length == FeatureSchema.Count) return a;
            var r = new int[FeatureSchema.Count];
            if (a != null) Array.Copy(a, r, Math.Min(a.Length, r.Length));
            return r;
        }
    }
}
