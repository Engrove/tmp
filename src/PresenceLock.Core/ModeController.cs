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
    ///   * the last <see cref="WindowSize"/> DECISION OPPORTUNITIES are kept as 0/1 outcomes
    ///     ("did we (or would we) fire on a user who was actually present?"). An opportunity is
    ///     an idle episode in which the model fired, or which lasted at least
    ///     <see cref="DecisionOpportunitySeconds"/>. Shorter episodes without a decision are
    ///     typing rhythm: no model decides there, and counting them as "clean" dilutes the rate
    ///     (measured on a real profile 2026-11-13: 362 episodes in ~4-5 h of use, at least 85 %
    ///     of them under 30 s; a window of 200 such episodes covered ~2.5-3 h, not days);
    ///   * the evidence window is time-aware: the newest outcomes back to the point where BOTH at
    ///     least <see cref="WindowSize"/> opportunities AND at least <see cref="MinWindowDays"/>
    ///     different days are covered (up to <see cref="WindowCapacity"/> stored). A light user
    ///     is judged on 200 opportunities (two to three weeks), a heavy one (a CAD user with ~55 long
    ///     silences a day) on all opportunities of the last five working days. One quiet afternoon
    ///     can never decide: a gate re-evaluated continuously on a short window is a first-passage test;
    ///   * promotion requires the Wilson 95 % UPPER confidence bound of that rate to be at
    ///     or below <see cref="TargetFalsePositiveRate"/>, at least <see cref="MinLearningDays"/>
    ///     elapsed, enough confirmed departures and decision precision (see MaxWrongShareOfDecisions).
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
        /// <summary>Minimum number of decision opportunities the gate needs.</summary>
        public const int WindowSize = 200;
        /// <summary>Minimum number of different (UTC) days the evidence must cover.</summary>
        public const int MinWindowDays = 5;
        /// <summary>Outcomes stored (ring). Enough for 200 opportunities a day over five days.</summary>
        public const int WindowCapacity = 1000;
        /// <summary>An episode without a decision counts only if it lasted at least this long (= SilenceProfile.MinSeconds).</summary>
        public const double DecisionOpportunitySeconds = 30.0;
        /// <summary>
        /// Meaning of the stored window. 2 = decision opportunities with day stamps (0.7.1). A profile
        /// written under an older rule counted every 2-s typing pause: its window is discarded on load
        /// (conservative: it can only delay promotion and the enforcing-mode quality check).
        /// </summary>
        public const int CurrentWindowRule = 2;
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

        // Rolling outcome ring over decision opportunities. Per slot: 0 = no decision (clean),
        // 1 = fired and verified right, 2 = fired and verified wrong, 3 = fired, truth unknown.
        // 2 and 3 count as "fired on a present user" per opportunity (uncertainty never helps).
        [DataMember] public byte[] FireWindow = new byte[WindowCapacity];
        /// <summary>Same slots: UTC day number (ticks / TicksPerDay) of the outcome.</summary>
        [DataMember] public int[] DayWindow = new int[WindowCapacity];
        [DataMember] public int WindowHead;
        [DataMember] public int WindowCount;           // stored outcomes (<= WindowCapacity)
        [DataMember] public int WindowRule = CurrentWindowRule;
        /// <summary>
        /// Second gate criterion (decision precision): among the window's VERIFIED decisions, the
        /// Wilson 95 % upper bound of the share that hit a present user must be at most this.
        /// The per-opportunity rate alone can hide a model whose every decision is wrong.
        /// </summary>
        [DataMember] public double MaxWrongShareOfDecisions = 0.5;
        /// <summary>Episodes without a decision that ended before DecisionOpportunitySeconds (not in the window).</summary>
        [DataMember] public int ShortEpisodesIgnored;
        /// <summary>Windows discarded because they were recorded under an older rule (migration).</summary>
        [DataMember] public int WindowResets;
        // The most recent FIRED outcome: a user correction must flip THAT slot, not whatever came last.
        [DataMember] public int LastFiredSlot = -1;
        [DataMember] public long PushSequence;
        [DataMember] public long LastFiredSequence = -1;

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

        // Evidence of the effective window, recomputed after every change (Evaluate runs every tick).
        // Not serialised: false (the default, also after deserialisation) means "recompute".
        private bool _evValid;
        private bool _evReady;
        private int _evN, _evK, _evDays, _evRight, _evWrong, _evUnverified;

        /// <summary>Repair fields after deserialisation (field initialisers do not run then).</summary>
        public void Normalize()
        {
            bool shapeOk = FireWindow != null && FireWindow.Length == WindowCapacity
                        && DayWindow != null && DayWindow.Length == WindowCapacity;
            if (!shapeOk || WindowRule != CurrentWindowRule)
            {
                if (WindowRule != CurrentWindowRule) WindowResets++;
                ResetWindow();
                WindowRule = CurrentWindowRule;
            }
            if (!(MaxWrongShareOfDecisions > 0 && MaxWrongShareOfDecisions <= 1)) MaxWrongShareOfDecisions = 0.5;
            if (WindowHead < 0 || WindowHead >= WindowCapacity) WindowHead = 0;
            if (WindowCount < 0 || WindowCount > WindowCapacity) WindowCount = 0;
            if (LastFiredSlot < -1 || LastFiredSlot >= WindowCapacity) LastFiredSlot = -1;
            if (ShortEpisodesIgnored < 0) ShortEpisodesIgnored = 0;
            _evValid = false;
        }

        private void ResetWindow()
        {
            FireWindow = new byte[WindowCapacity];
            DayWindow = new int[WindowCapacity];
            WindowHead = 0;
            WindowCount = 0;
            LastFiredSlot = -1;
            LastFiredSequence = -1;
            _evValid = false;
        }

        /// <summary>
        /// Everything that is THIS user's calibration (for an anonymised baseline): the recipient
        /// must earn its own promotion. Tunables are kept.
        /// </summary>
        public void ResetCalibration()
        {
            Mode = OperatingMode.Learning;
            LearningExtended = false;
            FirstSeenUtcTicks = 0;
            ConfirmedPositives = 0;
            FiredDecisions = 0;
            RejectedDecisions = 0;
            RecentFpRateEma = 0.0;
            StabilityEma = 1.0;
            PromotedUtcTicks = 0;
            PromotionWindowRate = 0.0;
            PromotionUpperBound = 0.0;
            PromotionForcedByPolicy = false;
            ShortEpisodesIgnored = 0;
            WindowResets = 0;
            PushSequence = 0;
            ResetWindow();
            WindowRule = CurrentWindowRule;
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

        private static int DayOf(long utcTicks) => (int)(utcTicks / TimeSpan.TicksPerDay);
        private static bool IsFalsePositive(byte fire) => fire == 2 || fire == 3;
        private int Slot(int age) => (WindowHead - 1 - age + 2 * WindowCapacity) % WindowCapacity;   // age 0 = newest

        private void PushOutcome(byte fire, long nowUtcTicks)
        {
            FireWindow[WindowHead] = fire;
            DayWindow[WindowHead] = DayOf(nowUtcTicks);
            if (fire != 0) { LastFiredSlot = WindowHead; LastFiredSequence = PushSequence; }
            PushSequence++;
            WindowHead = (WindowHead + 1) % WindowCapacity;
            if (WindowCount < WindowCapacity) WindowCount++;
            _evValid = false;
            RecentFpRateEma = (1 - FpAlpha) * RecentFpRateEma + FpAlpha * (IsFalsePositive(fire) ? 1.0 : 0.0);
            Prune();
        }

        /// <summary>
        /// Data minimisation (GDPR art. 5.1 c): once the evidence is complete, outcomes older than it
        /// can never be needed again (a newer outcome can only shorten the newest stretch that covers
        /// 200 opportunities on 5 days). They are cleared, day stamps included.
        /// </summary>
        private void Prune()
        {
            Evidence();
            if (!_evReady || WindowCount <= _evN) return;
            for (int age = _evN; age < WindowCount; age++)
            {
                int idx = Slot(age);
                FireWindow[idx] = 0;
                DayWindow[idx] = 0;
            }
            WindowCount = _evN;                    // the cached evidence covers exactly these: still valid
        }

        /// <summary>
        /// Record the outcome of ONE resolved idle episode (whether or not we fired).
        /// A clean opportunity contributes 0, so a model that has learned to stop firing wrongly
        /// earns its promotion. An episode without a decision that ended before
        /// <see cref="DecisionOpportunitySeconds"/> is not an opportunity and is only counted
        /// (<see cref="ShortEpisodesIgnored"/>).
        /// </summary>
        /// <param name="episodeSeconds">How long the episode lasted (idle seconds at its end).</param>
        public void RecordEpisodeOutcome(bool fired, bool rejected, double episodeSeconds, long nowUtcTicks)
        {
            if (fired) FiredDecisions++;
            if (rejected) RejectedDecisions++;
            if (!fired && !(episodeSeconds >= DecisionOpportunitySeconds))
            {
                ShortEpisodesIgnored++;
                return;
            }
            PushOutcome(fired ? (rejected ? (byte)2 : (byte)1) : (byte)0, nowUtcTicks);
        }

        /// <summary>
        /// Learning mode only: we "would have" fired, nothing was visible, and the user
        /// resumed AFTER the FP window. Truth unknown (reading the whole time, or a short
        /// trip?). No training label, but counted as a false positive for the gate:
        /// uncertainty must delay sharp mode, never hasten it.
        /// </summary>
        public void RecordUnverifiedFire(long nowUtcTicks)
        {
            FiredDecisions++;
            PushOutcome(3, nowUtcTicks);
        }

        public void RecordConfirmedPositive() => ConfirmedPositives++;

        /// <summary>
        /// The user explicitly flagged the most recent fired decision as wrong after its
        /// episode had already been scored as clean: flip THAT outcome to "wrong"
        /// (if it is still stored; later episodes may have been recorded meanwhile).
        /// </summary>
        public void RecordUserCorrection()
        {
            RejectedDecisions++;
            long age = PushSequence - 1 - LastFiredSequence;   // 0 = the newest stored outcome
            if (LastFiredSlot >= 0 && LastFiredSequence >= 0 && age >= 0 && age < WindowCount)
            {
                FireWindow[LastFiredSlot] = 2;
                _evValid = false;
            }
            RecentFpRateEma = Math.Min(1.0, RecentFpRateEma + FpAlpha);
        }

        /// <summary>Diagnostic: relative lock-time change caused by the latest correction.</summary>
        public void RecordUpdateChange(double relativeLockTimeChange)
        {
            StabilityEma = (1 - StabAlpha) * StabilityEma + StabAlpha * relativeLockTimeChange;
        }

        /// <summary>
        /// The effective window: newest outcomes back to where BOTH WindowSize opportunities and
        /// MinWindowDays different days are covered. Not ready while the stored outcomes cannot
        /// satisfy both; the figures then describe everything stored (for display only).
        /// </summary>
        private void Evidence()
        {
            if (_evValid) return;
            var days = new System.Collections.Generic.HashSet<int>();
            int n = 0, k = 0, right = 0, wrong = 0, unverified = 0;
            bool ready = false;
            for (int age = 0; age < WindowCount; age++)
            {
                int idx = Slot(age);
                byte f = FireWindow[idx];
                n++;
                if (IsFalsePositive(f)) k++;
                if (f == 1) right++; else if (f == 2) wrong++; else if (f == 3) unverified++;
                days.Add(DayWindow[idx]);
                if (n >= WindowSize && days.Count >= MinWindowDays) { ready = true; break; }
            }
            _evReady = ready; _evN = n; _evK = k; _evDays = days.Count;
            _evRight = right; _evWrong = wrong; _evUnverified = unverified;
            _evValid = true;
        }

        /// <summary>True when the stored outcomes cover WindowSize opportunities on MinWindowDays days.</summary>
        public bool WindowReady() { Evidence(); return _evReady; }

        /// <summary>Opportunities in the effective window (all stored ones while not ready).</summary>
        public int WindowOpportunities() { Evidence(); return _evN; }

        public int WindowFalsePositives() { Evidence(); return _evK; }

        public double WindowFalsePositiveRate() { Evidence(); return _evN == 0 ? 1.0 : _evK / (double)_evN; }

        /// <summary>Number of different UTC days in the effective window.</summary>
        public int WindowDays() { Evidence(); return _evDays; }

        /// <summary>Window counts of decisions: verified right, verified wrong, unverified.</summary>
        public void WindowDecisions(out int right, out int wrong, out int unverified)
        {
            Evidence();
            right = _evRight; wrong = _evWrong; unverified = _evUnverified;
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

        /// <summary>Wilson score 95 % upper bound of the false-positive rate per opportunity in the window.</summary>
        public double FalsePositiveUpperBound()
        {
            Evidence();
            return _evN == 0 ? 1.0 : WilsonUpper(_evK, _evN);
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
            bool fpSafe = WindowReady() && FalsePositiveUpperBound() <= TargetFalsePositiveRate;
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
                "mode={0}{1} days={2:F1}/{3} positives={4}/{5} " +
                "window: {6} opportunities on {17} days (needs >= {7} on >= {18}; {20}), +{19} short episodes not counted; " +
                "per opportunity: wrong {8:P1} upper95 {9:P1} (<= {10:P0}); " +
                "decisions: {12} right, {13} wrong, {14} unverified, wrong-share upper95 {15:P1} (<= {16:P0}); stability={11:F3}",
                Mode, LearningExtended ? " (LearningExtended: needs admin review)" : "",
                DaysElapsed(nowUtcTicks), MinLearningDays,
                ConfirmedPositives, MinConfirmedPositives,
                WindowOpportunities(), WindowSize,
                WindowFalsePositiveRate(), FalsePositiveUpperBound(), TargetFalsePositiveRate,
                StabilityEma, right, wrong, unverified, WrongDecisionUpperBound(), MaxWrongShareOfDecisions,
                WindowDays(), MinWindowDays, ShortEpisodesIgnored, WindowReady() ? "ready" : "collecting");
        }
    }
}
