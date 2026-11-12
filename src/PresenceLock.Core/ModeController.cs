using System;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    public enum OperatingMode
    {
        /// <summary>Observing only. NEVER locks. Optionally shows a "would lock" notice.</summary>
        Learning,
        /// <summary>Sharp mode. Soft-dim then LockWorkStation() when thresholds are crossed.</summary>
        Enforcing
    }

    /// <summary>Policy override coming from GPO/registry.</summary>
    public enum ModePolicy { Auto, ForceLearning, ForceEnforcing }

    /// <summary>
    /// Decides WHEN it is safe to leave the learning period and enter enforcing mode,
    /// silently and automatically.
    ///
    /// The gate is a statistical test, not a threshold crossing on a noisy average:
    ///   * the last <see cref="WindowSize"/> resolved idle episodes are kept as 0/1 outcomes
    ///     ("did we (or would we) fire on a user who was actually present?");
    ///   * promotion requires the Wilson 95 % UPPER confidence bound of that rate to be at
    ///     or below <see cref="TargetFalsePositiveRate"/>, with a full window, at least
    ///     <see cref="MinLearningDays"/> elapsed and enough confirmed departures.
    /// A plain EMA crossing a threshold is a first-passage event: given enough days, noise
    /// alone makes it dip below any threshold, so every user would eventually be promoted
    /// regardless of the true error rate. The confidence bound prevents exactly that.
    ///
    /// If the profile is still not safe after <see cref="MaxLearningDays"/>, it is NOT
    /// force-promoted; it stays in learning and is flagged <see cref="LearningExtended"/>
    /// for the administrator.
    /// </summary>
    [DataContract]
    public sealed class ModeController
    {
        public const int WindowSize = 200;   // ≈ 11 work days at ~18 idle episodes/day
        private const double Z95 = 1.959964;

        // Tunables (overridable via policy).
        [DataMember] public int MinLearningDays = 15;
        [DataMember] public int MaxLearningDays = 30;
        [DataMember] public double TargetFalsePositiveRate = 0.10; // upper 95 % bound must be <= this
        [DataMember] public int MinConfirmedPositives = 30;        // manual locks + certain absences

        // Live calibration state (persisted in the profile).
        [DataMember] public OperatingMode Mode = OperatingMode.Learning;
        [DataMember] public bool LearningExtended;
        [DataMember] public long FirstSeenUtcTicks;
        [DataMember] public int ConfirmedPositives;
        [DataMember] public int FiredDecisions;        // dims/locks the engine initiated (or would have)
        [DataMember] public int RejectedDecisions;     // of those, shown to be wrong

        // Rolling outcome window (true = fired on a present user).
        [DataMember] public bool[] OutcomeWindow = new bool[WindowSize];
        [DataMember] public int WindowHead;
        [DataMember] public int WindowCount;

        // Audit snapshot taken at the instant of promotion (exported for the administrator).
        [DataMember] public long PromotedUtcTicks;
        [DataMember] public double PromotionWindowRate;
        [DataMember] public double PromotionUpperBound;
        [DataMember] public bool PromotionForcedByPolicy;

        // Diagnostics only (not used by the gate).
        [DataMember] public double RecentFpRateEma = 0.0;
        [DataMember] public double StabilityEma = 1.0;

        private const double FpAlpha = 0.08;
        private const double StabAlpha = 0.05;

        /// <summary>Repair fields after deserialisation (field initialisers do not run then).</summary>
        public void Normalize()
        {
            if (OutcomeWindow == null || OutcomeWindow.Length != WindowSize)
            {
                OutcomeWindow = new bool[WindowSize];
                WindowHead = 0;
                WindowCount = 0;
            }
            if (WindowHead < 0 || WindowHead >= WindowSize) WindowHead = 0;
            if (WindowCount < 0 || WindowCount > WindowSize) WindowCount = 0;
        }

        public void EnsureStarted(long nowUtcTicks)
        {
            if (FirstSeenUtcTicks == 0) FirstSeenUtcTicks = nowUtcTicks;
        }

        public double DaysElapsed(long nowUtcTicks)
        {
            if (FirstSeenUtcTicks == 0) return 0.0;
            return (nowUtcTicks - FirstSeenUtcTicks) / (double)TimeSpan.TicksPerDay;
        }

        private void PushOutcome(bool falsePositive)
        {
            OutcomeWindow[WindowHead] = falsePositive;
            WindowHead = (WindowHead + 1) % WindowSize;
            if (WindowCount < WindowSize) WindowCount++;
            RecentFpRateEma = (1 - FpAlpha) * RecentFpRateEma + FpAlpha * (falsePositive ? 1.0 : 0.0);
        }

        /// <summary>
        /// Record the outcome of ONE resolved idle episode (whether or not we fired).
        /// A clean episode contributes 0, so a model that has learned to stop firing wrongly
        /// earns its promotion.
        /// </summary>
        public void RecordEpisodeOutcome(bool fired, bool rejected)
        {
            if (fired) FiredDecisions++;
            if (rejected) RejectedDecisions++;
            PushOutcome(fired && rejected);
        }

        /// <summary>
        /// Learning mode only: we "would have" fired, nothing was visible, and the user
        /// resumed AFTER the FP window. Truth unknown (reading the whole time, or a short
        /// trip?). No training label, but counted as a false positive for the gate:
        /// uncertainty must delay sharp mode, never hasten it.
        /// </summary>
        public void RecordUnverifiedFire()
        {
            FiredDecisions++;
            PushOutcome(true);
        }

        public void RecordConfirmedPositive() => ConfirmedPositives++;

        /// <summary>
        /// The user explicitly flagged the most recent fired decision as wrong after its
        /// episode had already been scored as clean: flip that last outcome to "false positive".
        /// </summary>
        public void RecordUserCorrection()
        {
            RejectedDecisions++;
            if (WindowCount > 0)
            {
                int last = (WindowHead - 1 + WindowSize) % WindowSize;
                OutcomeWindow[last] = true;
            }
            RecentFpRateEma = Math.Min(1.0, RecentFpRateEma + FpAlpha);
        }

        /// <summary>Diagnostic: relative lock-time change caused by the latest correction.</summary>
        public void RecordUpdateChange(double relativeLockTimeChange)
        {
            StabilityEma = (1 - StabAlpha) * StabilityEma + StabAlpha * relativeLockTimeChange;
        }

        public int WindowFalsePositives()
        {
            int k = 0;
            for (int i = 0; i < WindowCount; i++)
            {
                int idx = (WindowHead - 1 - i + 2 * WindowSize) % WindowSize;
                if (OutcomeWindow[idx]) k++;
            }
            return k;
        }

        public double WindowFalsePositiveRate() =>
            WindowCount == 0 ? 1.0 : WindowFalsePositives() / (double)WindowCount;

        /// <summary>Wilson score 95 % upper bound of the windowed false-positive rate.</summary>
        public double FalsePositiveUpperBound()
        {
            if (WindowCount == 0) return 1.0;
            double n = WindowCount;
            double p = WindowFalsePositives() / n;
            double z2 = Z95 * Z95;
            double denom = 1.0 + z2 / n;
            double center = p + z2 / (2.0 * n);
            double margin = Z95 * Math.Sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n));
            return Math.Min(1.0, (center + margin) / denom);
        }

        /// <summary>
        /// Re-evaluate the mode. Honours a policy override; otherwise applies the
        /// statistical promotion gate. Returns true if the mode changed.
        /// </summary>
        public bool Evaluate(long nowUtcTicks, ModePolicy policy)
        {
            OperatingMode previous = Mode;

            if (policy == ModePolicy.ForceLearning) { Mode = OperatingMode.Learning; return Mode != previous; }
            if (policy == ModePolicy.ForceEnforcing)
            {
                Mode = OperatingMode.Enforcing;
                if (previous != Mode) SnapshotPromotion(nowUtcTicks, forced: true);
                return Mode != previous;
            }

            if (Mode == OperatingMode.Enforcing) return false; // promotion is one-way under Auto

            double days = DaysElapsed(nowUtcTicks);
            bool minTime = days >= MinLearningDays;
            bool enoughData = ConfirmedPositives >= MinConfirmedPositives;
            bool windowFull = WindowCount >= WindowSize;
            bool fpSafe = windowFull && FalsePositiveUpperBound() <= TargetFalsePositiveRate;

            if (minTime && enoughData && fpSafe)
            {
                Mode = OperatingMode.Enforcing;
                LearningExtended = false;
                SnapshotPromotion(nowUtcTicks, forced: false);
            }
            else
            {
                LearningExtended = days >= MaxLearningDays;
            }
            return Mode != previous;
        }

        private void SnapshotPromotion(long nowUtcTicks, bool forced)
        {
            PromotedUtcTicks = nowUtcTicks;
            PromotionWindowRate = WindowFalsePositiveRate();
            PromotionUpperBound = FalsePositiveUpperBound();
            PromotionForcedByPolicy = forced;
        }

        /// <summary>Human-readable gate status; for the tray status box, logs and export.</summary>
        public string Explain(long nowUtcTicks)
        {
            return string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "mode={0}{1} days={2:F1}/{3} positives={4}/{5} window={6}/{7} " +
                "fpRate={8:P1} fpUpper95={9:P1}(<= {10:P0}) stability={11:F3}",
                Mode, LearningExtended ? " (LearningExtended: needs admin review)" : "",
                DaysElapsed(nowUtcTicks), MinLearningDays,
                ConfirmedPositives, MinConfirmedPositives,
                WindowCount, WindowSize,
                WindowFalsePositiveRate(), FalsePositiveUpperBound(), TargetFalsePositiveRate,
                StabilityEma);
        }
    }
}
