using System;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    public class ModelGuardTests
    {
        private readonly ITestOutputHelper _out;
        public ModelGuardTests(ITestOutputHelper o) { _out = o; }
        private static readonly long T0 = new DateTime(2026, 3, 2, 8, 0, 0, DateTimeKind.Utc).Ticks;

        private static FeatureVector Ctx(int ctx, double t)
        {
            var f = new FeatureVector { IdleSeconds = t };
            if (ctx == 1) f.X[FeatureSchema.CtxReading] = 1;
            if (ctx == 2) { f.X[FeatureSchema.CtxLeaving] = 1; f.X[FeatureSchema.AbruptStop] = 1; }
            return f;
        }

        /// <summary>
        /// Labels from a stationary "true" user: leaving context away at 20-60 s; reading context
        /// present up to 300 s and away beyond 400 s.
        /// </summary>
        private static FeedbackSample Label(UserSim.Lcg rng, long now)
        {
            switch (rng.UniformInt(1, 3))
            {
                case 1: return FeedbackSample.From(Ctx(2, rng.UniformInt(20, 60)), FeedbackKind.LongAbsence, now);
                case 2: return FeedbackSample.From(Ctx(1, rng.UniformInt(60, 300)), FeedbackKind.SoftDimRejected, now);
                default: return FeedbackSample.From(Ctx(1, rng.UniformInt(400, 900)), FeedbackKind.LongAbsence, now);
            }
        }

        private static void Feed(PresenceModel live, ModelGuard g, ModelGuardPolicy p, FeedbackSample s, ref int rollbacks)
        {
            g.Score(live, s);
            live.Update(s);
            if (g.Decide(live, s.TimestampUtcTicks, p) == ModelGuard.Verdict.RolledBack) rollbacks++;
        }

        private static double HeldOutLoss(PresenceModel m, long seed)
        {
            var rng = new UserSim.Lcg(seed);
            double sw = 0, sl = 0;
            for (int k = 0; k < 2000; k++)
            {
                var s = Label(rng, T0);
                sw += s.Weight;
                sl += s.Weight * ModelGuard.LogLoss(m.Probability(s.Features.X, s.Features.IdleSeconds), s.Label);
            }
            return sl / sw;
        }

        /// <summary>
        /// Criteria fixed before the run: on a user whose habits do not change, (a) no roll-back may
        /// make the model worse on 2000 fresh labels neither model has seen (tolerance 0.005 nats),
        /// and (b) roll-backs are rare: on average at most 1 per 4000 labels over 100 seeds.
        /// </summary>
        [Fact]
        public void StationaryUser_RollbacksAreRare_AndNeverMakeTheModelWorse()
        {
            var p = new ModelGuardPolicy();
            int total = 0, promotions = 0;
            double worstHarm = double.NegativeInfinity;
            const int Seeds = 100;
            for (long seed = 1; seed <= Seeds; seed++)
            {
                var live = new PresenceModel(); var g = new ModelGuard();
                var rng = new UserSim.Lcg(seed);
                for (int i = 0; i < 4000; i++)
                {
                    var smp = Label(rng, T0 + i * TimeSpan.TicksPerMinute);
                    g.Score(live, smp);
                    live.Update(smp);
                    var pre = live.DeepCopy();
                    if (g.Decide(live, smp.TimestampUtcTicks, p) == ModelGuard.Verdict.RolledBack)
                    {
                        total++;
                        double harm = HeldOutLoss(live, seed * 31 + i) - HeldOutLoss(pre, seed * 31 + i);
                        worstHarm = Math.Max(worstHarm, harm);
                        _out.WriteLine($"seed {seed} label {i}: roll-back, block mean {g.LastMeanDifference:+0.000} nats (z {g.LastZ:F1}); " +
                                       $"held-out loss after - before = {harm:+0.0000;-0.0000}");
                    }
                }
                promotions += g.Promotions;
            }
            _out.WriteLine($"{Seeds} seeds x 4000 labels: roll-backs {total}, promotions {promotions}, worst held-out harm of a roll-back " +
                           (total > 0 ? $"{worstHarm:+0.0000;-0.0000} nats" : "-"));
            Assert.True(total <= Seeds, $"{total} roll-backs");
            Assert.True(total == 0 || worstHarm <= 0.005, $"a roll-back made the model worse by {worstHarm:F4} nats");
            Assert.True(promotions >= Seeds * 20);
        }

        [Fact]
        public void CorruptedLiveModel_IsRolledBackToTheChampion_WithinTwoBlocks()
        {
            var live = new PresenceModel(); var g = new ModelGuard(); var p = new ModelGuardPolicy();
            var rng = new UserSim.Lcg(12);
            int rb = 0, i = 0;
            for (; i < 800; i++) Feed(live, g, p, Label(rng, T0 + i * TimeSpan.TicksPerMinute), ref rb);
            Assert.Equal(0, rb);
            var good = live.DeepCopy();
            // A damaging jump (a corrupted update, a burst of wrong labels): "away" after 5 s everywhere.
            live.W0 += 12;
            double before = live.Probability(Ctx(1, 120).X, 120);
            int start = i;
            while (rb == 0 && i < start + 2 * p.BlockSize + p.BlockSize) { Feed(live, g, p, Label(rng, T0 + i * TimeSpan.TicksPerMinute), ref rb); i++; }
            _out.WriteLine($"rolled back after {i - start} labels; " + g.Describe());
            Assert.Equal(1, rb);
            Assert.True(i - start <= 2 * p.BlockSize);
            Assert.True(live.Probability(Ctx(1, 120).X, 120) < before);
            Assert.True(Math.Abs(live.W0 - g.Champion.W0) < 1e-12);
        }

        [Fact]
        public void RealHabitChange_IsFollowed_NotRolledBack()
        {
            // The user starts studying drawings silently for up to 8 minutes (reading context now
            // present up to 480 s). The old champion is wrong about that; the live model adapts
            // and must be accepted, not rolled back.
            var live = new PresenceModel(); var g = new ModelGuard(); var p = new ModelGuardPolicy();
            var rng = new UserSim.Lcg(13);
            int rb = 0, i = 0;
            for (; i < 800; i++) Feed(live, g, p, Label(rng, T0 + i * TimeSpan.TicksPerMinute), ref rb);
            int promotionsBefore = g.Promotions;
            for (int k = 0; k < 800; k++, i++)
            {
                var s = rng.UniformInt(1, 2) == 1
                    ? FeedbackSample.From(Ctx(1, rng.UniformInt(300, 480)), FeedbackKind.SoftDimRejected, T0 + i * TimeSpan.TicksPerMinute)
                    : Label(rng, T0 + i * TimeSpan.TicksPerMinute);
                Feed(live, g, p, s, ref rb);
            }
            _out.WriteLine(g.Describe());
            Assert.Equal(0, rb);
            Assert.True(g.Promotions > promotionsBefore);
            Assert.True(live.Probability(Ctx(1, 420).X, 420) < 0.75);   // learned: studying at 7 min is presence
        }

        [Fact]
        public void BareEngine_HasNoGuard_SoParityWithTheReferenceIsUntouched()
        {
            var e = new PresenceEngine(new UserProfile());
            Assert.Null(e.GuardPolicy);
            var co = new PresenceCoordinator(e, new CoordinatorConfig());
            Assert.NotNull(e.GuardPolicy);
        }
    }
}

namespace PresenceLock.Core.Tests
{
    public class QualityMonitorTests
    {
        private static ModeController Enforcing(int falseDims, int episodes = 200)
        {
            var m = new ModeController { Mode = OperatingMode.Enforcing };
            for (int i = 0; i < episodes; i++) m.RecordEpisodeOutcome(i < falseDims, i < falseDims, 60, UserSim.BaseTicks + i * TimeSpan.TicksPerHour);
            return m;
        }

        [Fact]
        public void AlertsWhenFalseDimsExceedTheTarget_ClearsWithHysteresis_NeverDemotes()
        {
            var q = new QualityMonitor();
            var good = Enforcing(4);
            Assert.Equal(QualityMonitor.Change.None, q.Evaluate(good, 1));
            var bad = Enforcing(30);                            // 15 % measured: above the 10 % target
            Assert.Equal(QualityMonitor.Change.Degraded, q.Evaluate(bad, 2));
            Assert.Equal(QualityMonitor.Change.None, q.Evaluate(bad, 3));         // one alert per episode of trouble
            Assert.Equal(OperatingMode.Enforcing, bad.Mode);                        // protection stays on
            var borderline = Enforcing(18);                     // 9 %: below target, above 8 %: not yet restored (hysteresis)
            Assert.Equal(QualityMonitor.Change.None, q.Evaluate(borderline, 4));
            Assert.Equal(QualityMonitor.Change.Restored, q.Evaluate(good, 5));
            Assert.Equal(1, q.Alerts);
        }

        /// <summary>
        /// 0.7.1: the alert means "worse than the target", not "not proven better". A user at 5.5 %
        /// (the office simulation's measured rate) has an upper bound of ~9.6 %, right at the target;
        /// the old upper-bound rule alerted for 98 % of such users. 10.5 % measured alerts.
        /// </summary>
        [Fact]
        public void Alert_IsOnTheMeasuredShare_NotOnTheUpperBound()
        {
            var q = new QualityMonitor();
            var office = Enforcing(11);
            Assert.InRange(office.FalsePositiveUpperBound(), 0.09, 0.10);
            Assert.Equal(QualityMonitor.Change.None, q.Evaluate(office, 1));
            Assert.False(q.Degraded);
            Assert.Equal(QualityMonitor.Change.Degraded, q.Evaluate(Enforcing(21), 2));
        }

        [Fact]
        public void LearningMode_IsNotJudged()
        {
            var m = Enforcing(60); m.Mode = OperatingMode.Learning;
            Assert.Equal(QualityMonitor.Change.None, new QualityMonitor().Evaluate(m, 1));
        }

        [Fact]
        public void ExposureWindow_KeepsTheLast50()
        {
            var q = new QualityMonitor();
            for (int i = 1; i <= 60; i++) q.RecordExposure(i);
            Assert.Equal(50, q.ExposureCount);
            Assert.Equal(60, q.ExposureMax);
            Assert.Equal(36, q.ExposureMedian);
        }
    }
}
