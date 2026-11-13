using System;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// 0.7.2: GPO floor "MinLockIdleSeconds" (default 120 s). Criteria set before the runs:
    /// F1 no dim, would-lock notice, lock or disconnect before the floor, for any model and any signal
    /// flicker, in both modes; and the absolute bound HoldMax + grace still holds.
    /// </summary>
    public class FloorTests
    {
        private readonly ITestOutputHelper _out;
        public FloorTests(ITestOutputHelper o) { _out = o; }
        private const long Sec = TimeSpan.TicksPerSecond;
        private const long T0 = UserSim.BaseTicks;
        private static FeatureVector Neutral() => new FeatureVector();

        private static (PresenceCoordinator co, UserProfile p) Make(bool enforcing, CoordinatorConfig cfg)
        {
            var p = new UserProfile();
            if (enforcing) p.Modes.Mode = OperatingMode.Enforcing;
            return (new PresenceCoordinator(new PresenceEngine(p), cfg), p);
        }

        private static bool Acts(CoordinatorAction a) =>
            a == CoordinatorAction.SoftDim || a == CoordinatorAction.Lock || a == CoordinatorAction.Disconnect
            || a == CoordinatorAction.WouldLockNotice;

        [Theory]
        [InlineData(60.0)] [InlineData(120.0)] [InlineData(300.0)]
        public void F1_NothingHappensBeforeTheFloor_RandomModelsAndSignalFlicker(double floor)
        {
            var cfg = new CoordinatorConfig { MinLockIdleSeconds = floor };
            int bound = (int)(cfg.HoldMaxSeconds + cfg.ConfirmGraceSeconds) + 1;
            var rnd = new Random(20261113 + (int)floor);
            int earliest = int.MaxValue;
            for (int trial = 0; trial < 500; trial++)
            {
                bool enforcing = trial % 2 == 0;
                var (co, p) = Make(enforcing, cfg);
                p.Model.W0 = -30 + rnd.NextDouble() * 35;      // includes models that are certain at t = 0
                p.Model.U0 = -8 + rnd.NextDouble() * 10;
                for (int i = 0; i < FeatureSchema.Count; i++) { p.Model.W[i] = rnd.NextDouble() * 10 - 5; p.Model.U[i] = rnd.NextDouble() * 4 - 2; }
                var sig = new PassiveSignals();
                int nextFlip = 0, locked = -1;
                for (int s = 0; s <= 3000 && locked < 0; s++)
                {
                    if (s >= nextFlip)
                    {
                        sig = new PassiveSignals
                        {
                            DisplayRequired = rnd.Next(3) == 0 ? (bool?)null : rnd.Next(2) == 0,
                            MicrophoneInUse = rnd.Next(2) == 0,
                            CameraInUse = rnd.Next(4) == 0
                        };
                        nextFlip = s + 1 + rnd.Next(240);
                    }
                    var r = co.Tick(T0 + s * Sec, s, sig, ModePolicy.Auto, Neutral);
                    if (Acts(r.Action))
                    {
                        Assert.True(s >= floor, $"trial {trial} ({(enforcing ? "enforcing" : "learning")}): {r.Action} at {s} s, floor {floor} s");
                        earliest = Math.Min(earliest, s);
                    }
                    if (r.Action == CoordinatorAction.Lock) locked = s;
                }
                if (enforcing) Assert.True(locked >= 0 && locked <= bound, $"trial {trial}: locked at {locked}, bound {bound}");
            }
            _out.WriteLine($"floor {floor} s: earliest action at {earliest} s over 500 random models");
            Assert.Equal((int)floor, earliest);              // models certain from t = 0 act exactly at the floor
        }

        [Fact]
        public void FactoryModel_DimsAtTheFloor_NotAfter37Seconds()
        {
            var (co, _) = Make(true, new CoordinatorConfig());               // default floor 120 s
            int dim = -1, lockAt = -1;
            for (int s = 0; s <= 200 && lockAt < 0; s++)
            {
                var r = co.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Neutral);
                if (r.Action == CoordinatorAction.SoftDim && dim < 0) dim = s;
                if (r.Action == CoordinatorAction.Lock) lockAt = s;
            }
            Assert.Equal(120, dim);                                           // the dim always comes first
            Assert.InRange(lockAt, 123, 124);                                 // 3-s dim, then P >= 0.9
        }

        [Fact]
        public void LearningNotice_ComesAtTheFloor()
        {
            var (co, _) = Make(false, new CoordinatorConfig());
            int notice = -1;
            for (int s = 0; s <= 200 && notice < 0; s++)
                if (co.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Neutral).Action == CoordinatorAction.WouldLockNotice) notice = s;
            Assert.InRange(notice, 123, 124);                                 // factory model alone: ~47 s
        }

        [Fact]
        public void FloorAboveTheHorizon_RaisesTheBackstop()
        {
            // Fixed 180-s horizon (a never-firing model would otherwise move the learned horizon to its cap).
            var (co, p) = Make(true, new CoordinatorConfig { MinLockIdleSeconds = 300, LearnedHorizon = false });
            p.Model.W0 = -1000;                                                // the model never fires
            int dim = -1;
            for (int s = 0; s <= 400 && dim < 0; s++)
                if (co.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Neutral).Action == CoordinatorAction.SoftDim) dim = s;
            Assert.Equal(300, dim);                                            // not at the usual 180 s
        }

        [Fact]
        public void Floor_IsClampedToHoldMax_AndZeroRestoresTheOldTiming()
        {
            var (co, _) = Make(true, new CoordinatorConfig { MinLockIdleSeconds = 5000, HoldMaxSeconds = 900 });
            Assert.Equal(900, co.MinLockIdle());
            var (old, _) = Make(true, new CoordinatorConfig { MinLockIdleSeconds = 0 });
            int dim = -1;
            for (int s = 0; s <= 100 && dim < 0; s++)
                if (old.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Neutral).Action == CoordinatorAction.SoftDim) dim = s;
            Assert.InRange(dim, 37, 38);                                       // factory model: 37.3 s
        }
    }
}
