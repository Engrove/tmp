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
        public static UserProfile LoadOrCreate(string path, string userSid, string machineName)
        {
            try
            {
                if (File.Exists(path))
                {
                    var json = File.ReadAllText(path, Encoding.UTF8);
                    var p = Deserialize(json);   // migrates older schemas, rejects newer ones
                    if (p != null && p.SchemaVersion == UserProfile.CurrentSchemaVersion)
                        return p;
                }
            }
            catch
            {
                // fall through to a fresh profile
            }

            return new UserProfile
            {
                UserSid = userSid ?? "",
                MachineName = machineName ?? ""
            };
        }

        public static void Save(string path, UserProfile profile)
        {
            profile.UpdatedUtcTicks = DateTime.UtcNow.Ticks;
            Directory.CreateDirectory(Path.GetDirectoryName(path));

            // Atomic-ish: write temp then replace, so a crash mid-write cannot corrupt
            // the live profile.
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, Serialize(profile), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
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

            clone.Modes.Mode = OperatingMode.Learning;
            clone.Modes.LearningExtended = false;
            clone.Modes.FirstSeenUtcTicks = 0;
            clone.Modes.ConfirmedPositives = 0;
            clone.Modes.FiredDecisions = 0;
            clone.Modes.RejectedDecisions = 0;
            clone.Modes.RecentFpRateEma = 0.0;
            clone.Modes.StabilityEma = 1.0;
            clone.Modes.PromotedUtcTicks = 0;
            clone.Modes.PromotionWindowRate = 0.0;
            clone.Modes.PromotionUpperBound = 0.0;
            clone.Modes.PromotionForcedByPolicy = false;
            clone.Stats = new CoordinatorStats();
            clone.Modes.OutcomeWindow = new bool[ModeController.WindowSize];
            clone.Modes.WindowHead = 0;
            clone.Modes.WindowCount = 0;

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
