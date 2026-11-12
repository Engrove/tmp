using System;
using System.Collections.Generic;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// What does habit learning buy in a realistic office routine? Same user, same seeds, passive
    /// signals on in both variants, forced enforcing from day 21 (habits learn from day 0 in shadow
    /// mode and must earn the right to act). Acceptance criteria fixed BEFORE the first run:
    ///   a) both: zero hard locks on a present user
    ///   b) both: unattended exposure never exceeds HoldMax + grace (+2 s tick slack)
    ///   c) with habits: habit-triggered dims on present users &lt;= 5 % of presence episodes
    /// Gains are REPORTED, not asserted.
    /// </summary>
    public class HabitSimulationTests
    {
        private readonly ITestOutputHelper _out;
        public HabitSimulationTests(ITestOutputHelper output) { _out = output; }

        private static string Stat(List<int> v) =>
            v == null || v.Count == 0 ? "      -" : $"n={v.Count,3} median {v.OrderBy(x => x).ElementAt(v.Count / 2),4}s max {v.Max(),4}s";

        [Fact]
        public void HabitLearning_InAnOfficeRoutine()
        {
            var cfg = new CoordinatorConfig();
            int bound = (int)(cfg.HoldMaxSeconds + cfg.ConfirmGraceSeconds) + 2;
            foreach (var seed in new long[] { 1, 7, 42 })
            {
                var journal = new HabitJournal();
                var with = new CoordinatorSim(true, 21, habits: journal).RunRoutine(70, seed);
                var without = new CoordinatorSim(true, 21).RunRoutine(70, seed);
                HabitModel.Earned(journal, new HabitPolicy(), out int n, out double prec, out double lo);

                _out.WriteLine($"--- seed {seed}: habit verdicts scored {n}, precision {prec:P0} (Wilson lower {lo:P0}), " +
                               $"habit probes {with.Profile.Stats.HabitProbes} (answered {with.Profile.Stats.HabitProbesAnswered}), " +
                               $"journal {journal.Episodes.Count} episodes");
                var tags = with.Enforcing.ExposureByTag.Keys.Union(without.Enforcing.ExposureByTag.Keys).OrderBy(x => x);
                foreach (var tag in tags)
                {
                    with.Enforcing.ExposureByTag.TryGetValue(tag, out var a);
                    without.Enforcing.ExposureByTag.TryGetValue(tag, out var b);
                    _out.WriteLine($"  {tag,-18} without habits: {Stat(b)}   with habits: {Stat(a)}");
                }
                _out.WriteLine($"  dims on present users: without {without.Enforcing.DimsOnPresent}/{without.Enforcing.PresenceEpisodes}, " +
                               $"with {with.Enforcing.DimsOnPresent}/{with.Enforcing.PresenceEpisodes} " +
                               $"(of which habit-triggered {with.Enforcing.HabitDimsOnPresent})");

                foreach (var s in new[] { with, without })
                {
                    Assert.Equal(0, s.Enforcing.LocksOnPresent);                                   // a)
                    Assert.All(s.Enforcing.Exposure, e => Assert.True(e <= bound, $"{e} > {bound}")); // b)
                }
                Assert.True(with.Enforcing.HabitDimsOnPresent <= 0.05 * with.Enforcing.PresenceEpisodes,  // c)
                    $"habit dims on present {with.Enforcing.HabitDimsOnPresent} of {with.Enforcing.PresenceEpisodes}");
            }
        }
    }
}
