using System;
using System.Collections.Generic;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    public class CoordinatorHabitTests
    {
        private readonly ITestOutputHelper _out;
        public CoordinatorHabitTests(ITestOutputHelper output) { _out = output; }

        private const long Sec = TimeSpan.TicksPerSecond;
        private static readonly DateTime Monday = new DateTime(2026, 3, 2);

        private static HabitJournal Routine(bool earned)
        {
            var j = new HabitJournal();
            for (int back = 1; back <= 42; back++)
            {
                var day = Monday.AddDays(-back);
                if (day.DayOfWeek == DayOfWeek.Saturday || day.DayOfWeek == DayOfWeek.Sunday) continue;
                foreach (int h in new[] { 9, 10, 11, 14, 15 })
                    j.Episodes.Add(new HabitEpisode
                    {
                        EntryUtcTicks = new DateTime(day.Year, day.Month, day.Day, h, 15, 0, DateTimeKind.Utc).Ticks,
                        Lower = 240, Upper = 241
                    });
                j.Episodes.Add(new HabitEpisode
                {
                    EntryUtcTicks = new DateTime(day.Year, day.Month, day.Day, 17, back % 3 * 10, 0, DateTimeKind.Utc).Ticks,
                    Lower = 15 * 3600, Upper = 15 * 3600 + 15
                });
            }
            if (earned) for (int i = 0; i < 30; i++) j.Scores.Add(new HabitScore { Predicted = 0.95, Outcome = true, Source = 1 });
            return j;
        }

        private static HabitJournal Clone(HabitJournal j) => HabitStore.Deserialize(HabitStore.Serialize(j));

        private static (PresenceCoordinator co, UserProfile p) Make(bool enforcing, HabitJournal habits)
        {
            var p = new UserProfile();
            if (enforcing) p.Modes.Mode = OperatingMode.Enforcing;
            var cfg = new CoordinatorConfig { Habits = habits, UtcOffsetMinutes = _ => 0 };
            return (new PresenceCoordinator(new PresenceEngine(p), cfg), p);
        }

        private static FeatureVector Sig() => new FeatureVector();

        private static long At(int h, int m) => new DateTime(2026, 3, 2, h, m, 0, DateTimeKind.Utc).Ticks;

        /// <summary>
        /// The safety property of habit learning, on paired identical inputs: for ANY model and ANY
        /// signal pattern, habits never make a lock come LATER, and every habit-caused lock is
        /// preceded by a visible habit confirmation dim exactly ConfirmGrace seconds earlier.
        /// </summary>
        [Fact]
        public void Habits_NeverDelayALock_AndNeverLockWithoutAVisibleDim()
        {
            var rnd = new Random(31337);
            var routine = Routine(earned: true);
            int earlier = 0, habitLocks = 0;
            var starts = new[] { At(17, 5), At(22, 30), At(10, 15), At(16, 40) };
            for (int trial = 0; trial < 300; trial++)
            {
                double w0 = -30 + rnd.NextDouble() * 35, u0 = -8 + rnd.NextDouble() * 10;
                var w = Enumerable.Range(0, FeatureSchema.Count).Select(_ => rnd.NextDouble() * 10 - 5).ToArray();
                var u = Enumerable.Range(0, FeatureSchema.Count).Select(_ => rnd.NextDouble() * 4 - 2).ToArray();
                var signals = new List<PassiveSignals>();
                var cur = new PassiveSignals();
                for (int s = 0; s <= 2000; s++)
                {
                    if (rnd.Next(120) == 0)
                        cur = new PassiveSignals
                        {
                            DisplayRequired = rnd.Next(3) == 0 ? (bool?)null : rnd.Next(2) == 0,
                            MicrophoneInUse = rnd.Next(4) == 0
                        };
                    signals.Add(cur);
                }
                long start = starts[trial % starts.Length];

                int Run(HabitJournal habits, out LockCause cause, out int habitDimAt)
                {
                    var (co, p) = Make(enforcing: true, habits);
                    p.Model.W0 = w0; p.Model.U0 = u0;
                    Array.Copy(w, p.Model.W, w.Length); Array.Copy(u, p.Model.U, u.Length);
                    cause = LockCause.None; habitDimAt = -1;
                    for (int s = 0; s <= 2000; s++)
                    {
                        var r = co.Tick(start + s * Sec, s, signals[s], ModePolicy.Auto, Sig);
                        if (r.Action == CoordinatorAction.SoftDim && r.Cause == LockCause.Habit) habitDimAt = s;
                        if (r.Action == CoordinatorAction.Lock) { cause = r.Cause; return s; }
                    }
                    return int.MaxValue;
                }

                int with = Run(Clone(routine), out var causeWith, out int dimAt);
                int without = Run(null, out _, out _);
                Assert.True(with <= without, $"trial {trial}: with habits {with} > without {without}");
                if (causeWith == LockCause.Habit)
                {
                    habitLocks++;
                    Assert.Equal(with - 15, dimAt);                     // visible dim, full grace, then lock
                }
                if (with < without) earlier++;
            }
            _out.WriteLine($"habit-caused locks {habitLocks}/300, earlier than without habits in {earlier}/300");
            Assert.True(earlier > 0 && habitLocks > 0, "the property must not be vacuous");
        }

        [Fact]
        public void Habits_ThatHaveNotEarnedIt_NeverAct_ButAreShadowEvaluated()
        {
            var (co, p) = Make(enforcing: true, Routine(earned: false));
            var video = new PassiveSignals { DisplayRequired = true };
            for (int s = 0; s <= 920; s++)
            {
                var r = co.Tick(At(22, 30) + s * Sec, s, video, ModePolicy.Auto, Sig);
                Assert.NotEqual(LockCause.Habit, r.Cause);
            }
            Assert.True(p.Stats.HabitVerdicts > 0);                     // verdict issued (shadow)
            Assert.Equal(0, p.Stats.HabitProbes);
        }

        [Fact]
        public void Night_WithVideoLeftOn_IsConfirmedAfterTwoMinutes_InsteadOfFifteen()
        {
            var video = new PassiveSignals { DisplayRequired = true };
            int FirstDim(HabitJournal j)
            {
                var (co, _) = Make(enforcing: true, j);
                for (int s = 0; s <= 1000; s++)
                    if (co.Tick(At(22, 30) + s * Sec, s, video, ModePolicy.Auto, Sig).Action == CoordinatorAction.SoftDim) return s;
                return -1;
            }
            Assert.Equal(120, FirstDim(Routine(earned: true)));         // HabitEarlySeconds
            Assert.Equal(900, FirstDim(null));                         // HoldMax
        }

        [Fact]
        public void LearningMode_HabitsShowNothing()
        {
            var (co, _) = Make(enforcing: false, Routine(earned: true));
            var video = new PassiveSignals { DisplayRequired = true };
            for (int s = 0; s <= 3000; s++)
                Assert.Equal(CoordinatorAction.None, co.Tick(At(22, 30) + s * Sec, s, video, ModePolicy.Auto, Sig).Action);
        }

        [Fact]
        public void Journal_RecordsIdleUntilInput_AsABoundedInterval()
        {
            var j = new HabitJournal();
            var (co, _) = Make(enforcing: false, j);
            for (int s = 0; s <= 300; s++) co.Tick(At(10, 0) + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Sig);
            co.Tick(At(10, 0) + 301 * Sec, 0.0, default(PassiveSignals), ModePolicy.Auto, Sig);   // input
            var e = Assert.Single(j.Episodes);
            Assert.Equal(HabitEvidence.Bounded, e.Kind);
            Assert.InRange(e.Lower, 299, 301);
            Assert.InRange(e.Upper, 301, 303);
            Assert.Equal(At(10, 0), e.EntryUtcTicks);
        }

        [Fact]
        public void Journal_IdleDuringAVideo_IsExcluded_NotEvidenceOfAbsence()
        {
            var j = new HabitJournal();
            var (co, _) = Make(enforcing: false, j);
            var video = new PassiveSignals { DisplayRequired = true };
            for (int s = 0; s <= 600; s++) co.Tick(At(10, 0) + s * Sec, s, video, ModePolicy.Auto, Sig);
            co.Tick(At(10, 0) + 601 * Sec, 0.0, default(PassiveSignals), ModePolicy.Auto, Sig);
            Assert.Equal(HabitEvidence.Hold, Assert.Single(j.Episodes).Kind);
        }

        [Fact]
        public void Journal_LockThenUnlock_ReturnIsTheUnlock()
        {
            var j = new HabitJournal();
            var (co, _) = Make(enforcing: false, j);
            for (int s = 0; s <= 400; s++) co.Tick(At(12, 0) + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Sig);
            co.OnSessionLocked(At(12, 0) + 400 * Sec, 400, Sig);      // Windows inactivity lock
            co.OnSessionUnlocked(At(12, 0) + 4000 * Sec);              // back from lunch
            var e = Assert.Single(j.Episodes);
            Assert.Equal(HabitEvidence.Bounded, e.Kind);
            Assert.Equal(4000, e.Upper, 6);
            Assert.Equal(4000 - 15, e.Lower, 6);
        }

        [Fact]
        public void Scoring_VerdictsAreFrozenThenScoredByTheTrueReturn()
        {
            var j = Routine(earned: false);
            int before = j.Scores.Count;
            var (co, _) = Make(enforcing: false, j);
            for (int s = 0; s <= 200; s++) co.Tick(At(22, 30) + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Sig);
            co.Tick(At(22, 30) + 201 * Sec, 0.0, default(PassiveSignals), ModePolicy.Auto, Sig);   // back after 3 min
            Assert.Equal(before + 1, j.Scores.Count);
            Assert.False(j.Scores.Last().Outcome);                     // claimed "gone 10 min": wrong

            for (int s = 0; s <= 120; s++) co.Tick(At(23, 0) + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Sig);
            co.OnSessionLocked(At(23, 0) + 121 * Sec, 121, Sig);
            co.OnSessionUnlocked(At(23, 0) + 9 * 3600 * Sec);         // next morning
            Assert.True(j.Scores.Last().Outcome);
        }

        // ---------------------------------------------------------------- RDP & secure desktop

        [Fact]
        public void RdpDisconnect_IsSecure_NoLabel_NoDecisions_UntilReconnect()
        {
            var (co, p) = Make(enforcing: true, new HabitJournal());
            for (int s = 0; s <= 20; s++) co.Tick(At(10, 0) + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Sig);
            int positives = p.Modes.ConfirmedPositives, window = p.Modes.WindowCount;
            co.OnSessionDisconnected(At(10, 0) + 21 * Sec, 21);
            for (int s = 22; s <= 3000; s++)
                Assert.Equal(CoordinatorAction.None, co.Tick(At(10, 0) + s * Sec, s, default(PassiveSignals), ModePolicy.Auto, Sig).Action);
            Assert.Equal(positives, p.Modes.ConfirmedPositives);          // not a departure label
            Assert.Equal(window, p.Modes.WindowCount);
            Assert.Equal(1, p.Stats.Disconnects);
            co.OnSessionConnected(At(10, 0) + 3001 * Sec);
            Assert.Equal(CoordinatorAction.None, co.Tick(At(10, 0) + 3002 * Sec, 0.0, default(PassiveSignals), ModePolicy.Auto, Sig).Action);
            var r = co.Tick(At(10, 0) + 3100 * Sec, 98, default(PassiveSignals), ModePolicy.Auto, Sig);
            Assert.NotEqual(OperatingMode.Learning, r.Mode);                // decisions resume
        }

        [Fact]
        public void LockedWhileDisconnected_StaysLockedUntilTheRealUnlock()
        {
            var (co, _) = Make(enforcing: true, null);
            co.OnSessionDisconnected(At(10, 0), 30);
            co.OnSessionLocked(At(10, 0) + 60 * Sec, 90, Sig);
            co.OnSessionConnected(At(10, 0) + 600 * Sec);                  // lock screen shown now
            for (int s = 0; s < 100; s++)
                Assert.Equal(CoordinatorAction.None, co.Tick(At(10, 0) + (601 + s) * Sec, 200 + s, default(PassiveSignals), ModePolicy.Auto, Sig).Action);
            co.OnSessionUnlocked(At(10, 0) + 800 * Sec);
            var r = co.Tick(At(10, 0) + 801 * Sec, 0.0, default(PassiveSignals), ModePolicy.Auto, Sig);
            Assert.Equal(CoordinatorAction.None, r.Action);
        }

        [Fact]
        public void SecureDesktop_IsAHold_BoundedByTheBackstop()
        {
            var (co, p) = Make(enforcing: true, null);
            var uac = new PassiveSignals { InputDesktopObservable = false };
            Assert.Equal(HoldReason.SecureDesktop, co.EvaluateHold(uac));
            int firstDim = -1;
            for (int s = 0; s <= 920 && firstDim < 0; s++)
                if (co.Tick(At(10, 0) + s * Sec, s, uac, ModePolicy.Auto, Sig).Action == CoordinatorAction.SoftDim) firstDim = s;
            Assert.Equal(900, firstDim);                                    // no model dim; HoldMax probe
            Assert.Equal(1, p.Stats.HoldStarts);
        }
    }
}
