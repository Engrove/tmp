using System;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// Does the passive media/meeting hold measurably help? Same deterministic user, same seeds,
    /// with and without passive signals. The acceptance criteria below were fixed BEFORE the
    /// first run:
    ///   a) with hold:    zero "away" labels while the user was actually present
    ///   b) without hold: such wrong labels DO occur (the defect the hold fixes is real)
    ///   c) both:         zero hard locks on a present user
    ///   d) both:         unattended exposure never exceeds HoldMax + grace (+2 s tick slack)
    ///   e) both:         departures with no media/meeting running are locked within the learned-horizon
    ///                    cap + grace (fixed 180 s before v0.5; the cap is admin policy, default 600 s)
    ///   f) with hold:    dims shown to present users during media/meetings at most HALF of
    ///                    the no-hold rate
    ///
    /// Revised in v0.5 (learned horizon), with the measured reason: without signals the fixed
    /// 180 s backstop dimmed 90-91 % of media episodes; the learned horizon lets the model learn
    /// that silent watching is presence, which brings the no-signal variant down to ~53 %, at the
    /// price of short departures from that context returning to an unlocked PC (bounded by e).
    /// The hold still dominates on BOTH axes, which is what f) now requires:
    ///   f) with hold:    fewer media dims on present users AND no more unlocked returns than
    ///                    without (the old factor-2 claim was relative to the fixed horizon)
    /// </summary>
    public class PassiveHoldSimulationTests
    {
        private readonly ITestOutputHelper _out;
        public PassiveHoldSimulationTests(ITestOutputHelper output) { _out = output; }

        private static readonly long[] Seeds = { 1, 7, 42 };
        private const int Days = 60;

        private void Report(string name, CoordinatorSim s)
        {
            var E = s.Enforcing; var L = s.Learning;
            double mediaDimRate = E.MediaDimsOnPresent / (double)Math.Max(1, E.MediaEpisodes);
            _out.WriteLine(
                $"{name,-34} promoted={(s.PromotedDay?.ToString() ?? "no"),-3} " +
                $"wrongAwayLabels(L/E)={L.WrongAbsenceLabels}/{E.WrongAbsenceLabels}  " +
                $"ENF: mediaDims {E.MediaDimsOnPresent}/{E.MediaEpisodes}={mediaDimRate:P0}  " +
                $"allDims {E.DimsOnPresent}/{E.PresenceEpisodes}  hardLocksPresent={E.LocksOnPresent}  " +
                $"departures {E.Departures} lockedMax={(E.Exposure.Count > 0 ? E.Exposure.Max() : 0)}s " +
                $"median={(E.Exposure.Count > 0 ? E.Exposure.OrderBy(x => x).ElementAt(E.Exposure.Count / 2) : 0)}s " +
                $"plainMax={(E.PlainDepartureExposure.Count > 0 ? E.PlainDepartureExposure.Max() : 0)}s " +
                $"unlockedReturns={E.UnlockedReturns}  probes={s.Profile.Stats.HoldProbes}  " +
                $"ambiguous(away/unknown)={s.Profile.Stats.AmbiguousScoredAway}/{s.Profile.Stats.AmbiguousScoredUnknown}");
        }

        [Fact]
        public void PassiveHold_RemovesWrongLabels_AndReducesMediaDisturbance_WithinTheExposureBound()
        {
            var cfg = new CoordinatorConfig();
            int bound = (int)(cfg.HoldMaxSeconds + cfg.ConfirmGraceSeconds) + 2;
            int plainBound = (int)Math.Min(cfg.HoldMaxSeconds, Math.Max(180, cfg.MaxLearnedHorizonSeconds)) + (int)cfg.ConfirmGraceSeconds + 2;

            foreach (var seed in Seeds)
            {
                // Auto mode: what the promotion gate does with each variant.
                var autoHold = new CoordinatorSim(useSignals: true).Run(Days, seed);
                var autoNone = new CoordinatorSim(useSignals: false).Run(Days, seed);
                // Forced enforcing from day 15: like-for-like comparison of the sharp phase.
                var hold = new CoordinatorSim(useSignals: true, forceEnforcingFromDay: 15).Run(Days, seed);
                var none = new CoordinatorSim(useSignals: false, forceEnforcingFromDay: 15).Run(Days, seed);

                Report($"seed {seed} auto,   passive hold", autoHold);
                Report($"seed {seed} auto,   no signals", autoNone);
                Report($"seed {seed} forced, passive hold", hold);
                Report($"seed {seed} forced, no signals", none);

                // a) / b)
                Assert.Equal(0, hold.Learning.WrongAbsenceLabels + hold.Enforcing.WrongAbsenceLabels);
                Assert.Equal(0, autoHold.Learning.WrongAbsenceLabels + autoHold.Enforcing.WrongAbsenceLabels);
                Assert.True(none.Learning.WrongAbsenceLabels > 0);

                foreach (var s in new[] { hold, none, autoHold, autoNone })
                {
                    // c)
                    Assert.Equal(0, s.Enforcing.LocksOnPresent);
                    // d)
                    Assert.All(s.Enforcing.Exposure, e => Assert.True(e <= bound, $"exposure {e} > {bound}"));
                    // e)
                    Assert.All(s.Enforcing.PlainDepartureExposure, e => Assert.True(e <= plainBound, $"plain {e} > {plainBound}"));
                }
                // e2) with passive signals (the default) every departure is locked before the user is
                // back. WITHOUT them, silent video watching teaches the model that silence in that
                // context is presence, the learned horizon moves towards the cap, and a short break
                // from that context can end before the lock: bounded by e), never beyond cap + grace.
                Assert.Equal(0, hold.Enforcing.UnlockedReturns);
                Assert.Equal(0, autoHold.Enforcing.UnlockedReturns);

                // f)
                double rHold = hold.Enforcing.MediaDimsOnPresent / (double)hold.Enforcing.MediaEpisodes;
                double rNone = none.Enforcing.MediaDimsOnPresent / (double)none.Enforcing.MediaEpisodes;
                _out.WriteLine($"  seed {seed}: media dims hold {rHold:P0} vs none {rNone:P0}; unlocked returns hold " +
                               $"{hold.Enforcing.UnlockedReturns} vs none {none.Enforcing.UnlockedReturns}");
                Assert.True(rHold < rNone, $"hold {rHold:P0} vs none {rNone:P0}");
                Assert.True(hold.Enforcing.UnlockedReturns <= none.Enforcing.UnlockedReturns);
            }
        }

        /// <summary>Decision support, no assertion: the HoldMax trade-off the administrator sets via GPO.</summary>
        [Fact]
        public void HoldMax_Sensitivity_Report()
        {
            foreach (var minutes in new[] { 3, 5, 10, 15, 20 })
            {
                var cfg = new CoordinatorConfig { HoldMaxSeconds = minutes * 60 };
                var s = new CoordinatorSim(useSignals: true, forceEnforcingFromDay: 15, cfg: cfg).Run(Days, 7);
                var E = s.Enforcing;
                var mediaExposure = E.Exposure.Except(E.PlainDepartureExposure).ToList();
                _out.WriteLine($"HoldMax {minutes,2} min: media dims on present {E.MediaDimsOnPresent,3}/{E.MediaEpisodes} " +
                               $"({E.MediaDimsOnPresent / (double)E.MediaEpisodes:P0}), all dims {E.DimsOnPresent}/{E.PresenceEpisodes}, " +
                               $"max exposure {E.Exposure.Max()} s, hard locks on present {E.LocksOnPresent}");
            }
            var baseline = new CoordinatorSim(useSignals: false, forceEnforcingFromDay: 15).Run(Days, 7).Enforcing;
            _out.WriteLine($"no signals      : media dims on present {baseline.MediaDimsOnPresent,3}/{baseline.MediaEpisodes} " +
                           $"({baseline.MediaDimsOnPresent / (double)baseline.MediaEpisodes:P0}), all dims {baseline.DimsOnPresent}/{baseline.PresenceEpisodes}, " +
                           $"max exposure {baseline.Exposure.Max()} s, hard locks on present {baseline.LocksOnPresent}");
        }
    }
}
