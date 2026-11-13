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
        // Same slots: what kind of decision it was. 0 = none, 1 = fired and verified right,
        // 2 = fired and verified wrong, 3 = fired, truth unknown (counted as wrong per episode).
        [DataMember] public byte[] FireWindow = new byte[WindowSize];
        /// <summary>
        /// Second gate criterion (decision precision): among the window's VERIFIED decisions, the
        /// Wilson 95 % upper bound of the share that hit a present user must be at most this.
        /// The per-episode rate alone can hide a model whose every decision is wrong (10 of 10
        /// fires wrong is 5 % of 200 episodes).
        /// </summary>
        [DataMember] public double MaxWrongShareOfDecisions = 0.5;
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
            if (FireWindow == null || FireWindow.Length != WindowSize)
            {
                // Older profile: reconstruct conservatively (a past false positive was a wrong fire).
                FireWindow = new byte[WindowSize];
                for (int i = 0; i < WindowSize; i++) FireWindow[i] = OutcomeWindow[i] ? (byte)2 : (byte)0;
            }
            if (!(MaxWrongShareOfDecisions > 0 && MaxWrongShareOfDecisions <= 1)) MaxWrongShareOfDecisions = 0.5;
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

        private void PushOutcome(bool falsePositive, byte fire)
        {
            OutcomeWindow[WindowHead] = falsePositive;
            FireWindow[WindowHead] = fire;
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
            PushOutcome(fired && rejected, fired ? (rejected ? (byte)2 : (byte)1) : (byte)0);
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
            PushOutcome(true, 3);
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
                FireWindow[last] = 2;
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

        /// <summary>Window counts of decisions: verified right, verified wrong, unverified.</summary>
        public void WindowDecisions(out int right, out int wrong, out int unverified)
        {
            right = wrong = unverified = 0;
            for (int i = 0; i < WindowCount; i++)
            {
                int idx = (WindowHead - 1 - i + 2 * WindowSize) % WindowSize;
                switch (FireWindow[idx]) { case 1: right++; break; case 2: wrong++; break; case 3: unverified++; break; }
            }
        }

        /// <summary>
        /// Wilson 95 % upper bound of the share of VERIFIED decisions that hit a present user;
        /// 0 when no verified decision was wrong (a model that never fires, or only fires right).
        /// </summary>
        public double WrongDecisionUpperBound()
        {
            WindowDecisions(out int right, out int wrong, out _);
            return wrong == 0 ? 0.0 : WilsonUpper(wrong, right + wrong);
        }

        public static double WilsonUpper(int k, int n)
        {
            if (n <= 0) return 1.0;
            double p = k / (double)n, z2 = Z95 * Z95;
            double denom = 1.0 + z2 / n;
            double center = p + z2 / (2.0 * n);
            double margin = Z95 * Math.Sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n));
            return Math.Min(1.0, (center + margin) / denom);
        }

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
            bool precise = WrongDecisionUpperBound() <= MaxWrongShareOfDecisions;

            if (minTime && enoughData && fpSafe && precise)
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
            WindowDecisions(out int right, out int wrong, out int unverified);
            return string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "mode={0}{1} days={2:F1}/{3} positives={4}/{5} window={6}/{7} " +
                "per-episode: wrong {8:P1} upper95 {9:P1} (<= {10:P0}); " +
                "decisions in window: {12} right, {13} wrong, {14} unverified, wrong-share upper95 {15:P1} (<= {16:P0}); stability={11:F3}",
                Mode, LearningExtended ? " (LearningExtended: needs admin review)" : "",
                DaysElapsed(nowUtcTicks), MinLearningDays,
                ConfirmedPositives, MinConfirmedPositives,
                WindowCount, WindowSize,
                WindowFalsePositiveRate(), FalsePositiveUpperBound(), TargetFalsePositiveRate,
                StabilityEma, right, wrong, unverified, WrongDecisionUpperBound(), MaxWrongShareOfDecisions);
        }
    }
}
