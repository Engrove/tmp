using System;
using System.Collections.Generic;
using System.Globalization;

namespace PresenceLock.Core
{
    /// <summary>
    /// Consistency and coverage check of a profile (0.7.1). Encodes the manual analysis of the field
    /// profile of 2026-11-13, so that every pilot profile is checked the same way:
    ///  * ERROR: the profile contradicts the code (impossible counter relations, non-finite weights,
    ///    timestamps out of order). Such a profile must not be trusted.
    ///  * WARN: the profile is consistent but something needs a human: a context the model never saw
    ///    (e.g. no silent-work application at all), a recreated profile, a quality alert.
    ///  * INFO: what the model has learned and how far the gate is.
    /// Reads the profile only; no file access, no names, no times beyond what the profile holds.
    /// </summary>
    public static class ProfileDiagnostics
    {
        public enum Severity { Info, Warn, Error }

        public sealed class Finding
        {
            public Severity Severity;
            public string Code;
            public string Text;
            public override string ToString() =>
                "[" + Severity.ToString().ToUpperInvariant() + "] " + Code + ": " + Text;
        }

        /// <summary>Episodes after which a context that never occurred is worth a warning.</summary>
        public const int CoverageMinEpisodes = 200;

        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static List<Finding> Check(UserProfile p, long nowUtcTicks, string runningVersion = null)
        {
            var f = new List<Finding>();
            void Add(Severity s, string code, string text) => f.Add(new Finding { Severity = s, Code = code, Text = text });

            if (p == null) { Add(Severity.Error, "profile", "no profile"); return f; }
            var m = p.Model; var mc = p.Modes; var st = p.Stats ?? new CoordinatorStats();

            // ---- identity and life cycle ----------------------------------------------------------
            Add(Severity.Info, "version", "written by " + (string.IsNullOrEmpty(p.AppVersion) ? "?" : p.AppVersion) +
                ", schema " + p.SchemaVersion);
            if (!string.IsNullOrEmpty(runningVersion) && !string.IsNullOrEmpty(p.AppVersion) && p.AppVersion != runningVersion)
                Add(Severity.Info, "version", "running agent is " + runningVersion + " (the profile is updated at its next save)");
            string origin = string.IsNullOrEmpty(p.Origin) ? "unknown (profile written before 0.7.1)" : p.Origin;
            Add(origin.StartsWith("recreated", StringComparison.Ordinal) ? Severity.Warn : Severity.Info, "origin", origin);

            long slack = TimeSpan.TicksPerDay;   // clock corrections
            if (p.CreatedUtcTicks > 0 && p.UpdatedUtcTicks > 0 && p.UpdatedUtcTicks + slack < p.CreatedUtcTicks)
                Add(Severity.Error, "time", "updated before created");
            if (p.CreatedUtcTicks > 0 && mc.FirstSeenUtcTicks > 0 && mc.FirstSeenUtcTicks + slack < p.CreatedUtcTicks)
                Add(Severity.Error, "time", "learning started before the profile was created");
            if (nowUtcTicks > 0 && p.UpdatedUtcTicks > nowUtcTicks + slack)
                Add(Severity.Error, "time", "updated in the future (clock?)");

            // ---- model ------------------------------------------------------------------------------
            bool finite = IsFinite(m.W0) && IsFinite(m.U0);
            for (int i = 0; i < FeatureSchema.Count; i++) finite &= IsFinite(m.W[i]) && IsFinite(m.U[i]);
            if (!finite) Add(Severity.Error, "model", "non-finite weight");

            // ---- counters that the code relates -----------------------------------------------------
            if (mc.RejectedDecisions > mc.FiredDecisions)
                Add(Severity.Error, "counters", "more rejected decisions (" + mc.RejectedDecisions + ") than decisions (" + mc.FiredDecisions + ")");
            for (int i = 0; i < FeatureSchema.Count; i++)
                if (p.OptionalAvailable[i] > p.OptionalSeen[i])
                    Add(Severity.Error, "counters", "sensor " + FeatureSchema.Names[i] + " available more often than observed");
            if (mc.WindowCount > ModeController.WindowCapacity || mc.WindowCount < 0)
                Add(Severity.Error, "counters", "window count out of range");
            if (mc.WindowCount > mc.PushSequence)
                Add(Severity.Error, "counters", "more outcomes stored than ever recorded");
            int[] byCtx = st.EpisodesByContext ?? new int[SilenceProfile.Contexts];
            int episodes = 0; foreach (int n in byCtx) episodes += n;
            if (st.RemoteEpisodes > episodes || st.PostHoldEpisodes > episodes)
                Add(Severity.Error, "counters", "remote/post-hold episodes exceed all episodes");
            if (mc.Mode == OperatingMode.Learning && mc.PromotedUtcTicks == 0 && st.LockRequests > 0)
                Add(Severity.Warn, "counters", "lock requests in a profile that was never in enforcing mode (forced by policy earlier?)");

            // ---- gate -----------------------------------------------------------------------------
            Add(Severity.Info, "gate", mc.Explain(nowUtcTicks));
            long recorded = mc.PushSequence + mc.ShortEpisodesIgnored;
            if (recorded > 0)
                Add(Severity.Info, "episodes", string.Format(Inv,
                    "{0} resolved episodes since the window rule of 0.7.1: {1} typing pauses under {2:F0} s without a decision ({3:P0}), {4} decision opportunities",
                    recorded, mc.ShortEpisodesIgnored, ModeController.DecisionOpportunitySeconds,
                    mc.ShortEpisodesIgnored / (double)recorded, mc.PushSequence));
            if (mc.WindowResets > 0)
                Add(Severity.Info, "gate", "window recorded under an older rule was discarded " + mc.WindowResets + " time(s) (0.7.1 migration)");
            if (p.Quality != null && p.Quality.Degraded)
                Add(Severity.Warn, "quality", p.Quality.Describe(mc));

            // ---- coverage -------------------------------------------------------------------------
            if (episodes > 0)
            {
                Add(Severity.Info, "coverage", string.Format(Inv,
                    "episodes by context since 0.7.1: neutral {0}, silent-work (reading list) {1}, leaving {2}; Remote Desktop {3}; after media/meeting {4}",
                    byCtx[0], byCtx[1], byCtx[2], st.RemoteEpisodes, st.PostHoldEpisodes));
                if (episodes >= CoverageMinEpisodes && byCtx[1] == 0)
                    Add(Severity.Warn, "coverage", "no episode in a silent-work application (CAD, PDF, Office, IDE, calls) in " + episodes +
                        " episodes. If the user works in such an application, its process name is missing from the reading list: " +
                        "add it with the policy ExtraReadingApps (Task Manager, Details tab, without .exe).");
                if (st.RemoteEpisodes > 0)
                    Add(Severity.Info, "coverage", string.Format(Inv, "{0:P0} of the episodes were in Remote Desktop sessions",
                        st.RemoteEpisodes / (double)episodes));
            }
            else if (st.ObservedDepartures + mc.ConfirmedPositives > 0)
                Add(Severity.Info, "coverage", "no context counters yet (profile written before 0.7.1)");

            // ---- what the model has learned -----------------------------------------------------
            var neutral = new double[FeatureSchema.Count];
            var reading = new double[FeatureSchema.Count]; reading[FeatureSchema.CtxReading] = 1;
            var leaving = new double[FeatureSchema.Count]; leaving[FeatureSchema.CtxLeaving] = 1;
            var remote = new double[FeatureSchema.Count]; remote[FeatureSchema.RemoteSession] = 1;
            Add(Severity.Info, "model", "dim / lock (P >= " + p.Config.SoftDimThreshold.ToString(Inv) + " / " + p.Config.LockThreshold.ToString(Inv) + "): " +
                Times(p, neutral, "neutral") + "; " + Times(p, reading, "silent-work") + "; " +
                Times(p, leaving, "leaving") + "; " + Times(p, remote, "Remote Desktop") +
                string.Format(Inv, " (factory model: {0:F0} / {1:F0} s)",
                    new PresenceModel().LockTime(neutral, p.Config.SoftDimThreshold, 900), new PresenceModel().LockTime(neutral, p.Config.LockThreshold, 900)));
            if (p.Guard != null) Add(Severity.Info, "kaizen", p.Guard.Describe());
            Add(Severity.Info, "labels", string.Format(Inv,
                "confirmed departures {0}, rejected decisions {1}, decisions {2}; observed departures {3}, assumed from inactivity {4} (since 0.7.0)",
                mc.ConfirmedPositives, mc.RejectedDecisions, mc.FiredDecisions, st.ObservedDepartures, st.AssumedAbsenceLabels));
            return f;
        }

        private static string Times(UserProfile p, double[] x, string name) => string.Format(Inv, "{0} {1:F0} / {2:F0} s", name,
            p.Model.LockTime(x, p.Config.SoftDimThreshold, 900), p.Model.LockTime(x, p.Config.LockThreshold, 900));

        private static bool IsFinite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);

        public static bool HasErrors(IEnumerable<Finding> findings)
        {
            foreach (var x in findings) if (x.Severity == Severity.Error) return true;
            return false;
        }
    }
}
