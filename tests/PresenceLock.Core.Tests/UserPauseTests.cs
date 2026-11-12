using System;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// User pause. Criteria fixed before the run:
    ///  a) a script that tries to (re)start a pause every minute for a week never gets more pause in
    ///     ANY sliding 24-hour window than the budget, whatever strategy it uses;
    ///  b) a computer left during a pause is locked within HoldMax + grace (default policy);
    ///  c) with the confirmation switched off by policy, nothing locks during the pause, and the
    ///     computer is locked within the grace period after the pause ends if nobody is there;
    ///  d) nothing is learned from a paused silence;
    ///  e) deleting entries from the user-writable file cannot restore budget (NIS2 merge).
    /// </summary>
    public class UserPauseTests
    {
        private readonly ITestOutputHelper _out;
        public UserPauseTests(ITestOutputHelper o) { _out = o; }
        private const long Sec = TimeSpan.TicksPerSecond, Min = TimeSpan.TicksPerMinute;
        private static readonly long T0 = new DateTime(2026, 3, 2, 8, 0, 0, DateTimeKind.Utc).Ticks;

        [Fact]
        public void Ledger_ChargesInFull_RefundsNothing_AndKnowsWhenBudgetReturns()
        {
            var p = new PausePolicy();                       // 30/60/90, 120 min / 24 h
            var l = new PauseLedger();
            Assert.Null(l.WhyNot(90, T0, p));
            Assert.NotNull(l.WhyNot(45, T0, p));             // not an allowed length
            Assert.True(l.TryStart(90, T0, p, out _));
            Assert.NotNull(l.WhyNot(30, T0 + Min, p));       // already running
            Assert.Equal(10, l.End(T0 + 10 * Min), 6);       // ended after 10 min...
            Assert.Equal(30, l.RemainingMinutes(T0 + 11 * Min, p), 6);   // ...but 90 were charged
            Assert.True(l.TryStart(30, T0 + 11 * Min, p, out _));
            Assert.Equal(0, l.RemainingMinutes(T0 + 12 * Min, p), 6);
            Assert.NotNull(l.WhyNot(30, T0 + 50 * Min, p));
            long at = l.AvailableAt(30, T0 + 50 * Min, p);
            _out.WriteLine($"30 min available again at +{(at - T0) / (double)Min:F1} min");
            // Both charges slide out of the window together: at T0 + 24 h + x the charge is
            // (90 - x) + (30 - (x - 11)) for x >= 11, which is <= 90 from x = 20.5 min.
            Assert.InRange((at - T0) / (double)Min, 24 * 60 + 20.5 - 0.01, 24 * 60 + 20.5 + 0.01);
            Assert.Null(l.WhyNot(30, at, p));
            Assert.Equal(long.MaxValue, l.AvailableAt(300, T0, new PausePolicy { BudgetMinutesPer24h = 120, OptionsMinutes = new[] { 300 } }));
        }

        [Theory]
        [InlineData("largest-first")]
        [InlineData("smallest-and-end-immediately")]
        [InlineData("random")]
        public void AutoHotkey_RestartingEveryMinuteForAWeek_NeverExceedsTheBudget(string strategy)
        {
            var p = new PausePolicy();
            var l = new PauseLedger();
            var rng = new UserSim.Lcg(99);
            var paused = new bool[7 * 24 * 60];
            int starts = 0;
            for (int m = 0; m < paused.Length; m++)
            {
                long now = T0 + m * Min;
                if (l.IsActive(now)) { paused[m] = true; continue; }
                int[] order = strategy == "largest-first" ? new[] { 90, 60, 30 }
                            : strategy == "smallest-and-end-immediately" ? new[] { 30 }
                            : new[] { new[] { 30, 60, 90 }[rng.UniformInt(0, 2)] };
                foreach (int len in order)
                    if (l.TryStart(len, now, p, out _))
                    {
                        starts++;
                        if (strategy == "smallest-and-end-immediately") l.End(now + Min);
                        break;
                    }
                paused[m] = l.IsActive(now);
                if (m % 1440 == 0) l.Retire(now);           // cleaning service
            }
            int worst = 0;
            for (int end = 1440; end <= paused.Length; end++)
                worst = Math.Max(worst, paused.Skip(end - 1440).Take(1440).Count(x => x));
            _out.WriteLine($"{strategy}: {starts} pauses started in 7 days; worst 24-hour window paused {worst} min (budget {p.BudgetMinutesPer24h}); " +
                           $"ledger entries kept {l.Intervals.Count}");
            Assert.True(worst <= p.BudgetMinutesPer24h, $"{worst} min");
            Assert.True(l.Intervals.Count <= 8);             // retired: only the last 24 h is kept
        }

        // ---- coordinator: what a pause does -------------------------------------------------

        private static FeatureVector Leaving()
        {
            var f = new FeatureVector();
            f.X[FeatureSchema.CtxLeaving] = 1; f.X[FeatureSchema.AbruptStop] = 1; f.X[FeatureSchema.EdgeFling] = 1; f.X[FeatureSchema.MicroJerk] = 1;
            return f;
        }

        private static (PresenceCoordinator co, UserProfile p) Make(bool enforcing, PausePolicy pause = null)
        {
            var p = new UserProfile();
            if (enforcing) p.Modes.Mode = OperatingMode.Enforcing;
            var cfg = new CoordinatorConfig();
            if (pause != null) cfg.Pause = pause;
            return (new PresenceCoordinator(new PresenceEngine(p), cfg), p);
        }

        /// <summary>The user starts a pause at idle 0 and walks away; returns the idle second of the lock (or -1).</summary>
        private static int LeaveDuringPause(PresenceCoordinator co, int pauseMinutes, int seconds)
        {
            Assert.True(co.TryStartPause(pauseMinutes, T0, out _));
            for (int s = 0; s <= seconds; s++)
            {
                var r = co.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Leaving);
                if (r.Action == CoordinatorAction.Lock) return s;
            }
            return -1;
        }

        [Fact]
        public void LeftDuringAPause_IsLockedWithinHoldMaxPlusGrace()
        {
            var (co, p) = Make(enforcing: true);
            int locked = LeaveDuringPause(co, 90, 3600);
            _out.WriteLine($"left at the start of a 90-min pause with leaving cues: locked at {locked} s (HoldMax 900 + grace 15)");
            Assert.InRange(locked, 900, 900 + 15 + 1);
            // Without the pause the same departure is locked by the model within seconds:
            var (co2, _) = Make(enforcing: true);
            int normal = -1;
            for (int s = 0; s <= 900 && normal < 0; s++)
                if (co2.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Leaving).Action == CoordinatorAction.Lock) normal = s;
            _out.WriteLine($"same departure without a pause: locked at {normal} s");
            Assert.True(normal > 0 && normal < 120);
        }

        [Fact]
        public void FullPauseByPolicy_NoLockDuringThePause_LockRightAfterIt()
        {
            var (co, p) = Make(enforcing: true, pause: new PausePolicy { KeepConfirmation = false });
            int locked = LeaveDuringPause(co, 30, 3600);
            _out.WriteLine($"full pause of 30 min, nobody there: locked at {locked} s (pause ends at 1800 s)");
            Assert.InRange(locked, 1800, 1800 + 15 + 2);
        }

        [Fact]
        public void PausedSilence_TeachesNothing()
        {
            var (co, p) = Make(enforcing: false);
            p.Model.W0 = -1000;
            double before = p.Model.Probability(Leaving().X, 600);
            Assert.True(co.TryStartPause(60, T0, out _));
            for (int s = 0; s <= 1500; s++) co.Tick(T0 + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Leaving);
            Assert.Equal(0, p.Modes.ConfirmedPositives);            // HoldMax in learning would have labelled "away"
            Assert.Equal(before, p.Model.Probability(Leaving().X, 600));
        }

        [Fact]
        public void PolicyOff_OrNoBudget_NoPause()
        {
            var (a, _) = Make(true, new PausePolicy { Enabled = false });
            Assert.False(a.TryStartPause(30, T0, out string why1));
            var (b, _) = Make(true, new PausePolicy { BudgetMinutesPer24h = 0 });
            Assert.False(b.TryStartPause(30, T0, out string why2));
            _out.WriteLine(why1 + " / " + why2);
        }

        [Fact]
        public void EditingTheFile_CannotRestoreBudget()
        {
            var p = new PausePolicy();
            var real = new UserProfile();
            Assert.True(real.Pause.TryStart(90, T0, p, out _));
            var protectedCopy = ProfileStore.Deserialize(ProfileStore.Serialize(real));     // guard's copy after its sync
            var edited = ProfileStore.Deserialize(ProfileStore.Serialize(real));
            edited.Pause.Intervals.Clear();                                                   // the user "forgets" the pause
            Assert.Equal(120, edited.Pause.RemainingMinutes(T0 + 5 * Min, p), 6);
            TamperProtection.MergePauseLedger(edited, protectedCopy);                         // what the agent does on load
            Assert.Equal(30, edited.Pause.RemainingMinutes(T0 + 5 * Min, p), 6);
            // and an "early end" written into the file can only shorten the pause, never refund:
            var shortened = ProfileStore.Deserialize(ProfileStore.Serialize(real));
            shortened.Pause.Intervals[0].ChargedEndUtcTicks = T0 + Min;
            TamperProtection.MergePauseLedger(shortened, protectedCopy);
            Assert.Equal(30, shortened.Pause.RemainingMinutes(T0 + 5 * Min, p), 6);
        }

        [Fact]
        public void Ledger_SurvivesTheProfileRoundTrip_AndIsRetiredAfter24h()
        {
            var prof = new UserProfile();
            Assert.True(prof.Pause.TryStart(60, T0, new PausePolicy(), out _));
            var back = ProfileStore.Deserialize(ProfileStore.Serialize(prof));
            Assert.True(back.Pause.IsActive(T0 + 30 * Min));
            Assert.Equal(60, back.Pause.ChargedMinutes(T0 + 30 * Min), 6);
            Assert.Equal(1, Housekeeping.RetirePauses(back, T0 + 25 * TimeSpan.TicksPerHour));
            Assert.Empty(back.Pause.Intervals);
            Assert.Equal(1, back.Pause.PausesStarted);              // the running totals stay for --status
        }
    }
}
