using System;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    public class GateTests
    {
        private readonly ITestOutputHelper _out;
        public GateTests(ITestOutputHelper output) { _out = output; }

        private const long T0 = UserSim.BaseTicks;
        private const long Day = TimeSpan.TicksPerDay;

        /// <summary>Time of the i-th of n outcomes spread evenly over 'days' from 'start'.</summary>
        internal static long Spread(int i, int n, long start, int days = 10) => start + (long)i * days * Day / n;

        private static ModeController Gate(int fpCount, int positives = 40, double day = 16,
                                           int n = ModeController.WindowSize)
        {
            var mc = new ModeController();
            mc.EnsureStarted(T0);
            for (int i = 0; i < n; i++) mc.RecordEpisodeOutcome(true, i < fpCount, 60, Spread(i, n, T0));
            mc.ConfirmedPositives = positives;
            mc.Evaluate(T0 + (long)(day * TimeSpan.TicksPerDay), ModePolicy.Auto);
            return mc;
        }

        [Fact] public void Unsafe20Percent_StaysLearning() =>
            Assert.Equal(OperatingMode.Learning, Gate(40).Mode);

        [Fact]
        public void Safe2Percent_Promotes_WithAuditSnapshot()
        {
            var mc = Gate(4);
            Assert.Equal(OperatingMode.Enforcing, mc.Mode);
            Assert.True(mc.PromotionUpperBound <= mc.TargetFalsePositiveRate);
            Assert.Equal(0.02, mc.PromotionWindowRate, 12);
            Assert.False(mc.PromotionForcedByPolicy);
        }

        [Fact] public void TooFewPositives_Stays() => Assert.Equal(OperatingMode.Learning, Gate(4, positives: 10).Mode);
        [Fact] public void TooEarly_Stays() => Assert.Equal(OperatingMode.Learning, Gate(4, day: 14).Mode);
        [Fact] public void WindowNotFull_Stays() => Assert.Equal(OperatingMode.Learning, Gate(3, n: 150).Mode);

        [Fact]
        public void UnsafeAfterMaxDays_IsNotForcePromoted_ButFlagged()
        {
            var mc = Gate(40, day: 31);
            Assert.Equal(OperatingMode.Learning, mc.Mode);
            Assert.True(mc.LearningExtended);
        }

        [Fact]
        public void PolicyOverrides_Win()
        {
            var mc = Gate(4);
            mc.Evaluate(T0 + 16 * TimeSpan.TicksPerDay, ModePolicy.ForceLearning);
            Assert.Equal(OperatingMode.Learning, mc.Mode);
            var mc2 = Gate(60);
            mc2.Evaluate(T0 + 16 * TimeSpan.TicksPerDay, ModePolicy.ForceEnforcing);
            Assert.Equal(OperatingMode.Enforcing, mc2.Mode);
            Assert.True(mc2.PromotionForcedByPolicy);
        }

        [Fact]
        public void WilsonUpperBound_KnownValue()
        {
            // 4 / 200: Wilson 95 % interval upper bound = 0.0503... (textbook value)
            var mc = Gate(4, day: 1);
            Assert.InRange(mc.FalsePositiveUpperBound(), 0.0500, 0.0506);
        }

        private static (bool promoted, int at, int naive) Stream(double p, int n, int seed)
        {
            var rnd = new Random(seed);
            var mc = new ModeController();
            mc.EnsureStarted(T0);
            mc.ConfirmedPositives = 40;
            int naive = 0;
            for (int i = 0; i < n; i++)
            {
                long at = T0 + (i / 40) * Day;
                mc.RecordEpisodeOutcome(true, rnd.NextDouble() < p, 60, at);
                if (mc.WindowCount >= ModeController.WindowSize && mc.RecentFpRateEma <= mc.TargetFalsePositiveRate)
                    naive++;
                mc.Evaluate(Math.Max(at, T0 + 20 * Day), ModePolicy.Auto);
                if (mc.Mode == OperatingMode.Enforcing) return (true, i, naive);
            }
            return (false, n, naive);
        }

        [Fact]
        public void TrueRateAboveTarget_NeverPromotes_NoFirstPassage()
        {
            var r = Stream(0.15, 20000, 3);
            _out.WriteLine($"true 15%: promoted={r.promoted}, naive EMA gate would have fired {r.naive} times");
            Assert.False(r.promoted);
            Assert.True(r.naive > 0);
        }

        [Fact]
        public void TrueRateWellBelowTarget_PromotesPromptly()
        {
            var r = Stream(0.03, 20000, 3);
            Assert.True(r.promoted);
            Assert.True(r.at < 400);
        }
    
        // ------------------------------------------------------------------ 0.7.1: decision opportunities

        [Fact]
        public void ShortEpisodeWithoutDecision_IsNotAnOpportunity_ButIsCounted()
        {
            var mc = new ModeController();
            for (int i = 0; i < 100; i++) mc.RecordEpisodeOutcome(false, false, 2 + i % 28, T0 + i * 50 * TimeSpan.TicksPerSecond);
            Assert.Equal(0, mc.WindowCount);
            Assert.Equal(100, mc.ShortEpisodesIgnored);
            mc.RecordEpisodeOutcome(true, true, 12, T0);           // a decision in a short pause IS one
            mc.RecordEpisodeOutcome(false, false, 30, T0);         // 30 s without a decision is one
            mc.RecordUnverifiedFire(T0);
            Assert.Equal(3, mc.WindowCount);
            Assert.Equal(2, mc.WindowFalsePositives());
            Assert.Equal(100, mc.ShortEpisodesIgnored);
        }

        [Fact]
        public void TwoHundredCleanOpportunities_OnFewerThanFiveDays_DoNotPromote()
        {
            var mc = new ModeController();
            mc.EnsureStarted(T0 - 20 * Day);
            mc.ConfirmedPositives = 40;
            long morning = T0 - T0 % Day + 8 * TimeSpan.TicksPerHour;
            for (int i = 0; i < 200; i++) mc.RecordEpisodeOutcome(false, false, 60, morning + i * 60 * TimeSpan.TicksPerSecond);
            mc.Evaluate(morning + 4 * TimeSpan.TicksPerHour, ModePolicy.Auto);
            _out.WriteLine(mc.Explain(morning + 4 * TimeSpan.TicksPerHour));
            Assert.False(mc.WindowReady());
            Assert.Equal(OperatingMode.Learning, mc.Mode);       // one clean afternoon must not decide
            for (int d = 1; d <= 3; d++)
                for (int i = 0; i < 40; i++) mc.RecordEpisodeOutcome(false, false, 60, morning + d * Day + i * 60 * TimeSpan.TicksPerSecond);
            mc.Evaluate(morning + 3 * Day + 4 * TimeSpan.TicksPerHour, ModePolicy.Auto);
            Assert.Equal(4, mc.WindowDays());
            Assert.Equal(OperatingMode.Learning, mc.Mode);
            mc.RecordEpisodeOutcome(false, false, 60, morning + 4 * Day);
            mc.Evaluate(morning + 4 * Day + TimeSpan.TicksPerHour, ModePolicy.Auto);
            _out.WriteLine(mc.Explain(morning + 4 * Day + TimeSpan.TicksPerHour));
            Assert.True(mc.WindowReady());
            Assert.Equal(5, mc.WindowDays());
            Assert.Equal(200, mc.WindowOpportunities());           // the newest 200 now reach back into a fifth day
            Assert.Equal(OperatingMode.Enforcing, mc.Mode);
        }

        /// <summary>
        /// A heavy user (a CAD user with ~55 long silences a day): 200 opportunities fit in four days,
        /// so the window grows to cover five. With a fixed 200-slot window the gate could never open
        /// for exactly the user this product is for (found by the CAD simulation, 0.7.1 development).
        /// </summary>
        [Fact]
        public void HeavyUser_WindowGrowsToFiveDays_AndCanBePromoted()
        {
            var mc = new ModeController();
            mc.EnsureStarted(T0);
            mc.ConfirmedPositives = 40;
            int? promoted = null;
            for (int day = 0; day < 31 && promoted == null; day++)
                for (int i = 0; i < 60; i++)
                {
                    long at = T0 + day * Day + i * 8 * 60 * TimeSpan.TicksPerSecond;
                    bool fired = i % 30 == 0, wrong = fired && i == 0 && day % 5 == 0;          // 2 decisions a day, 1 wrong in 10
                    mc.RecordEpisodeOutcome(fired, wrong, 120, at);
                    mc.Evaluate(at, ModePolicy.Auto);
                    if (mc.Mode == OperatingMode.Enforcing) { promoted = day; break; }
                }
            _out.WriteLine(mc.Explain(T0 + 31 * Day));
            Assert.Equal(15, promoted);
            Assert.True(mc.WindowOpportunities() >= ModeController.WindowSize);
            Assert.True(mc.WindowDays() >= ModeController.MinWindowDays);
        }

        [Fact]
        public void UserCorrection_FlipsTheFiredDecision_NotTheLatestEpisode()
        {
            var mc = new ModeController();
            mc.RecordEpisodeOutcome(true, false, 50, T0);        // the would-lock (looked clean)
            mc.RecordEpisodeOutcome(false, false, 40, T0);       // a later opportunity before the user flags it
            mc.RecordEpisodeOutcome(false, false, 5, T0);        // and a typing pause
            mc.RecordUserCorrection();
            mc.WindowDecisions(out int right, out int wrong, out _);
            Assert.Equal(0, right);
            Assert.Equal(1, wrong);
            Assert.Equal(1, mc.WindowFalsePositives());
            Assert.Equal(0, mc.FireWindow[(mc.WindowHead - 1 + ModeController.WindowCapacity) % ModeController.WindowCapacity]);
        }

        /// <summary>
        /// Field profile 2026-11-13 (ELHO, 0.7.0): 362 idle episodes in ~4-5 h of use, at least 85 % under
        /// 30 s. Reproduced here with 73 episodes per active hour (66 under 30 s) and on average ONE decision
        /// per active hour on a present user, at irregular times. Under 0.7.0 the 200-episode window covered ~2.7 h and its per-episode rate
        /// stayed far below 10 %; the 0.7.1 window counts opportunities only and must keep the user in learning.
        /// </summary>
        [Theory]
        [InlineData(false)]   // the decision is an unverified invisible fire
        [InlineData(true)]    // the decision is a verified wrong dim
        public void FieldProfile_OneBadDecisionPerHour_IsNotPromoted(bool verifiedWrong)
        {
            var mc = new ModeController();
            mc.EnsureStarted(T0);
            mc.ConfirmedPositives = 40;
            var rng = new UserSim.Lcg(5);                                   // irregular, like real mistakes
            var last200 = new System.Collections.Generic.Queue<bool>();   // what the 0.7.0 window held
            int old070Passes = 0;
            for (int day = 0; day < 31; day++)
                for (int h = 0; h < 6; h++)
                    for (int k = 0; k < 73; k++)
                    {
                        long at = T0 + day * Day + ((8 + h) * 3600L + k * 49) * TimeSpan.TicksPerSecond;
                        bool shortPause = k < 66, bad = !shortPause && rng.UniformInt(1, 7) == 1;   // 1 per hour on average
                        if (shortPause) mc.RecordEpisodeOutcome(false, false, 2 + (k * 7) % 28, at);
                        else if (bad && verifiedWrong) mc.RecordEpisodeOutcome(true, true, 45, at);
                        else if (bad) mc.RecordUnverifiedFire(at);
                        else mc.RecordEpisodeOutcome(false, false, 30 + (k * 37) % 270, at);
                        last200.Enqueue(bad);
                        if (last200.Count > 200) last200.Dequeue();
                        int k070 = 0; foreach (var b in last200) if (b) k070++;
                        bool precise070 = !verifiedWrong || k070 == 0;   // 0.7.0: no right decisions here, so any wrong one blocked
                        if (day >= 15 && last200.Count == 200 && ModeController.WilsonUpper(k070, 200) <= 0.10 && precise070) old070Passes++;
                        mc.Evaluate(at, ModePolicy.Auto);
                    }
            _out.WriteLine(mc.Explain(T0 + 31 * Day));
            _out.WriteLine($"0.7.0 window would have passed the gate at {old070Passes} evaluations after day 15");
            Assert.True(old070Passes > 0);                         // the defect, reproduced
            Assert.Equal(OperatingMode.Learning, mc.Mode);         // 0.7.1
            Assert.True(mc.LearningExtended);
            Assert.True(mc.FalsePositiveUpperBound() > 0.10);
            Assert.True(mc.WindowDays() >= ModeController.MinWindowDays);
        }

        [Fact]
        public void FieldProfile_CleanUser_IsPromotedAfterDay15()
        {
            var mc = new ModeController();
            mc.EnsureStarted(T0);
            mc.ConfirmedPositives = 40;
            int? promoted = null;
            for (int day = 0; day < 31 && promoted == null; day++)
                for (int h = 0; h < 6 && promoted == null; h++)
                    for (int k = 0; k < 73; k++)
                    {
                        long at = T0 + day * Day + ((8 + h) * 3600L + k * 49) * TimeSpan.TicksPerSecond;
                        mc.RecordEpisodeOutcome(false, false, k < 66 ? 2 + (k * 7) % 28 : 30 + (k * 37) % 270, at);
                        mc.Evaluate(at, ModePolicy.Auto);
                        if (mc.Mode == OperatingMode.Enforcing) { promoted = day; break; }
                    }
            Assert.Equal(15, promoted);
        }
    
        /// <summary>GDPR art. 5.1 c: nothing older than the evidence is kept, day stamps included.</summary>
        [Fact]
        public void OutcomesOlderThanTheEvidence_AreCleared()
        {
            var mc = new ModeController();
            for (int day = 0; day < 12; day++)
                for (int i = 0; i < 60; i++)
                    mc.RecordEpisodeOutcome(i == 0, false, 90, T0 + day * Day + i * 300 * TimeSpan.TicksPerSecond);
            Assert.True(mc.WindowReady());
            Assert.Equal(mc.WindowOpportunities(), mc.WindowCount);
            Assert.InRange(mc.WindowCount, ModeController.WindowSize, 5 * 60);
            Assert.Equal(mc.WindowCount, mc.DayWindow.Count(d => d != 0));        // no stale day stamps
            Assert.Equal(5, mc.WindowDays());
            var q = ProfileStore.Deserialize(ProfileStore.Serialize(new UserProfile { Modes = mc }));
            Assert.Equal(mc.WindowFalsePositives(), q.Modes.WindowFalsePositives());
            Assert.Equal(mc.WindowOpportunities(), q.Modes.WindowOpportunities());
        }
    }
}
