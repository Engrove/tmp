using System;
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

        private static ModeController Gate(int fpCount, int positives = 40, double day = 16,
                                           int n = ModeController.WindowSize)
        {
            var mc = new ModeController();
            mc.EnsureStarted(T0);
            for (int i = 0; i < n; i++) mc.RecordEpisodeOutcome(true, i < fpCount);
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
                mc.RecordEpisodeOutcome(true, rnd.NextDouble() < p);
                if (mc.WindowCount >= ModeController.WindowSize && mc.RecentFpRateEma <= mc.TargetFalsePositiveRate)
                    naive++;
                mc.Evaluate(T0 + 20 * TimeSpan.TicksPerDay, ModePolicy.Auto);
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
    }
}
