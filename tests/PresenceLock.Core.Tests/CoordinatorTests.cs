using System;
using System.Linq;
using PresenceLock.Core;
using Xunit;

namespace PresenceLock.Core.Tests
{
    public class CoordinatorTests
    {
        private const long Sec = TimeSpan.TicksPerSecond;
        private const long T0 = UserSim.BaseTicks;

        private static readonly PassiveSignals NoSignals = default(PassiveSignals);
        private static readonly PassiveSignals Video = new PassiveSignals { DisplayRequired = true };
        private static readonly PassiveSignals Mic = new PassiveSignals { MicrophoneInUse = true };

        private static (PresenceCoordinator co, UserProfile p) Make(bool enforcing, CoordinatorConfig cfg = null)
        {
            var p = new UserProfile();
            if (enforcing) p.Modes.Mode = OperatingMode.Enforcing;
            return (new PresenceCoordinator(new PresenceEngine(p), cfg ?? new CoordinatorConfig()), p);
        }

        private static FeatureVector Sig()
        {
            var f = new FeatureVector();
            foreach (int i in FeatureSchema.Kinematic) f.X[i] = 1.0;
            return f;
        }

        /// <summary>Feed idle seconds from..to (inclusive) with a signal function; returns the actions by idle second.</summary>
        private static CoordinatorResult[] Run(PresenceCoordinator co, int from, int to, Func<int, PassiveSignals> signal)
        {
            var res = new CoordinatorResult[to + 1];
            for (int s = from; s <= to; s++)
                res[s] = co.Tick(T0 + s * Sec, s, signal(s), ModePolicy.Auto, Sig);
            return res;
        }

        private static FeatureVector ReadingSig()
        {
            var f = Sig();
            f.X[FeatureSchema.CtxReading] = 1.0;          // silent-work application (CAD, PDF, IDE)
            return f;
        }

        private static CoordinatorResult[] Run(PresenceCoordinator co, int from, int to, Func<FeatureVector> sig)
        {
            var res = new CoordinatorResult[to + 1];
            for (int s = from; s <= to; s++)
                res[s] = co.Tick(T0 + s * Sec, s, NoSignals, ModePolicy.Auto, sig);
            return res;
        }

        private static int First(CoordinatorResult[] r, CoordinatorAction a) =>
            Enumerable.Range(0, r.Length).FirstOrDefault(i => r[i].Action == a && i > 0);

        [Fact]
        public void NoSignals_BehavesLikeThePlainModel()
        {
            var (co, _) = Make(enforcing: true);
            var r = Run(co, 0, 120, s => NoSignals);
            int dim = First(r, CoordinatorAction.SoftDim), lk = First(r, CoordinatorAction.Lock);
            Assert.InRange(dim, 37, 39);                 // neutral baseline: P >= 75 % at 37.3 s
            Assert.InRange(lk, 47, 49);                  // P >= 90 % at 47.2 s, dim had >= 3 s
            Assert.Equal(LockCause.Model, r[lk].Cause);
        }

        [Fact]
        public void UnavailableSignals_AreNoEvidence()
        {
            var (co, _) = Make(enforcing: true);
            var unknown = new PassiveSignals { DisplayRequired = null, MicrophoneInUse = null, CameraInUse = null };
            var r = Run(co, 0, 120, s => unknown);
            Assert.InRange(First(r, CoordinatorAction.SoftDim), 37, 39);
        }

        [Fact]
        public void MediaHold_PausesModel_ProducesNoLabels_ThenProbesAtHoldMax()
        {
            var (co, p) = Make(enforcing: true);
            var w = (double[])p.Model.W.Clone();
            int window = p.Modes.WindowCount, positives = p.Modes.ConfirmedPositives;

            var r = Run(co, 0, 920, s => Video);

            Assert.True(r.Take(900).All(x => x.Action != CoordinatorAction.SoftDim && x.Action != CoordinatorAction.Lock));
            Assert.Equal(CoordinatorAction.SoftDim, r[900].Action);
            Assert.Equal(LockCause.HoldProbe, r[900].Cause);
            Assert.Equal(CoordinatorAction.Lock, r[915].Action);
            Assert.Equal(LockCause.HoldProbe, r[915].Cause);
            Assert.Equal(w, p.Model.W);                               // model untouched
            Assert.Equal(window, p.Modes.WindowCount);                // gate untouched
            Assert.Equal(positives, p.Modes.ConfirmedPositives);      // no "absence" label for a viewer
            Assert.Equal(1, p.Stats.HoldStarts);
            Assert.Equal(1, p.Stats.HoldProbeLocks);
        }

        [Fact]
        public void LearningMode_HoldNeverShowsAnything_AndNeverLabels()
        {
            var (co, p) = Make(enforcing: false);
            var r = Run(co, 0, 3600, s => Mic);
            Assert.True(r.All(x => x.Action == CoordinatorAction.None));
            Assert.Equal(0, p.Modes.ConfirmedPositives);
            Assert.Equal(0, p.Modes.WindowCount);
        }

        [Fact]
        public void HoldProbe_Answered_IsCountedAndCleared()
        {
            var (co, p) = Make(enforcing: true);
            Run(co, 0, 905, s => Video);
            var back = co.Tick(T0 + 906 * Sec, 0.0, Video, ModePolicy.Auto, Sig);   // user nudges the mouse
            Assert.Equal(CoordinatorAction.CancelDim, back.Action);
            Assert.Equal(1, p.Stats.HoldProbesAnswered);
            Assert.Equal(0, p.Stats.HoldProbeLocks);
        }

        [Fact]
        public void HoldEnd_StartsPostHoldEpisode_ClockedFromHoldEnd_WithKinematicsZeroed()
        {
            var (co, _) = Make(enforcing: true);
            var r = Run(co, 0, 420, s => s <= 300 ? Video : NoSignals);
            var ep = co.Engine.CurrentSignature;
            int dim = First(r, CoordinatorAction.SoftDim);
            Assert.InRange(dim, 301 + 36, 301 + 39);           // baseline t75 measured from hold end
            Assert.True(dim > 300);
            Assert.Equal(CoordinatorAction.Lock, r[First(r, CoordinatorAction.Lock)].Action);
            Assert.Null(ep);                                      // model locked -> episode resolved
        }

        [Fact]
        public void PostHoldSignature_HasFlagAndNoStaleKinematics()
        {
            var f = Sig();
            PresenceCoordinator.MarkPostHold(f);
            Assert.Equal(1.0, f.X[FeatureSchema.PostHold]);
            Assert.All(FeatureSchema.Kinematic, i => Assert.Equal(0.0, f.X[i]));
        }

        [Theory]
        [InlineData(180.0)]
        [InlineData(300.0)]
        [InlineData(600.0)]
        public void Backstop_LocksADepartureTheModelMissed_AtTheCap(double cap)
        {
            // A model that never reaches P(away) = 0.75 within the cap (W0 = -1000; note that W0 = -30
            // is NOT enough: the hazard term grows with t and crosses 0.75 at ~283 s) leaves the
            // learned horizon at the admin cap, and not one second further.
            var (co, p) = Make(enforcing: true, cfg: new CoordinatorConfig { MaxLearnedHorizonSeconds = cap });
            p.Model.W0 = -1000;
            int c = (int)cap;
            var r = Run(co, 0, c + 20, s => NoSignals);
            Assert.Equal(CoordinatorAction.None, r[c - 1].Action);
            Assert.Equal(CoordinatorAction.SoftDim, r[c].Action);
            Assert.Equal(LockCause.Backstop, r[c].Cause);
            Assert.Equal(CoordinatorAction.Lock, r[c + 15].Action);
            Assert.Equal(LockCause.Backstop, r[c + 15].Cause);
            Assert.Equal(1, p.Modes.ConfirmedPositives);          // verified absence -> positive label
            Assert.Equal(1, p.Stats.BackstopLocks);
        }

        [Fact]
        public void Backstop_LegacyFixedHorizon_Is180s()
        {
            var (co, p) = Make(enforcing: true, cfg: new CoordinatorConfig { LearnedHorizon = false });
            p.Model.W0 = -1000;
            var r = Run(co, 0, 200, s => NoSignals);
            Assert.Equal(CoordinatorAction.SoftDim, r[180].Action);
            Assert.Equal(CoordinatorAction.Lock, r[195].Action);
        }

        [Fact]
        public void LearnedHorizon_FollowsTheModel_BetweenFloorAndCap()
        {
            // W0 = -20: P(away) reaches the soft-dim threshold 0.75 at t ≈ 192 s, so the
            // certain-absence horizon is the model's own expectation, not 180 s and not the cap.
            var (co, p) = Make(enforcing: true);
            p.Model.W0 = -20;
            double expect = p.Model.LockTime(Sig().X, p.Config.SoftDimThreshold, 600);
            Assert.InRange(expect, 185, 200);
            var r = Run(co, 0, 230, s => NoSignals);
            int first = First(r, CoordinatorAction.SoftDim);
            Assert.InRange(first, (int)Math.Floor(expect), (int)Math.Ceiling(expect) + 1);
            Assert.Equal(CoordinatorAction.Lock, r[First(r, CoordinatorAction.Lock)].Action);
            Assert.True(First(r, CoordinatorAction.Lock) <= first + 15 + 1);
        }

        [Fact]
        public void Backstop_Answered_IsATruthfulPresentLabel()
        {
            var (co, p) = Make(enforcing: true, cfg: new CoordinatorConfig { MaxLearnedHorizonSeconds = 180 });
            p.Model.W0 = -20;                 // P(t) < 0.75 for all t < 180 (no model dim), P(180) ≈ 0.45
            var x = Sig();
            double before = p.Model.Probability(x.X, 180);
            Run(co, 0, 185, s => NoSignals);
            co.Tick(T0 + 186 * Sec, 0.0, NoSignals, ModePolicy.Auto, Sig);         // user reacts
            Assert.Equal(1, p.Stats.BackstopAnswered);
            Assert.Equal(1, p.Modes.WindowFalsePositives());                     // a dim reached a present user
            Assert.True(p.Model.Probability(x.X, 180) < before);                 // learned: present at 180 s
        }

        [Fact]
        public void Learning_SilenceEndingWithInput_IsNotLabelledAway()
        {
            // Studying a drawing in a silent-work application for 5 minutes without touching
            // anything, then drawing again.
            var (co, p) = Make(enforcing: false);
            p.Model.W0 = -1000;                                   // no invisible fire either
            Run(co, 0, 300, ReadingSig);
            co.Tick(T0 + 301 * Sec, 0.0, NoSignals, ModePolicy.Auto, ReadingSig);
            Assert.Equal(0, p.Modes.ConfirmedPositives);          // legacy code labelled this "away" at 180 s
        }

        [Fact]
        public void Learning_SilentWorkApp_CertainAbsenceOnlyAtHoldMax()
        {
            var (co, p) = Make(enforcing: false);
            p.Model.W0 = -1000;
            Run(co, 0, 899, ReadingSig);
            Assert.Equal(0, p.Modes.ConfirmedPositives);
            Run(co, 900, 901, ReadingSig);
            Assert.Equal(1, p.Modes.ConfirmedPositives);
        }

        [Theory]
        [InlineData(5, false)]     // unlocked within the FP window: the user was sitting there
        [InlineData(600, true)]    // unlocked ten minutes later: the user had left
        public void Learning_WindowsLock_IsDecidedByTheUnlockTime(int unlockAfter, bool away)
        {
            var (co, p) = Make(enforcing: false);
            p.Model.W0 = -30;
            Run(co, 0, 240, ReadingSig);
            double before = p.Model.Probability(ReadingSig().X, 240);
            co.OnSessionLocked(T0 + 240 * Sec, 240, ReadingSig);               // Windows' own inactivity lock
            Assert.Equal(0, p.Modes.ConfirmedPositives);                // undecided while locked
            co.OnSessionUnlocked(T0 + (240 + unlockAfter) * Sec);
            Assert.Equal(away ? 1 : 0, p.Modes.ConfirmedPositives);
            double after = p.Model.Probability(ReadingSig().X, 240);
            Assert.True(away ? after > before : after < before);
        }

        [Fact]
        public void MeetingHold_CanBeDisabledByPolicy()
        {
            var (co, _) = Make(enforcing: true, cfg: new CoordinatorConfig { MeetingHoldEnabled = false });
            var r = Run(co, 0, 60, s => Mic);
            Assert.InRange(First(r, CoordinatorAction.SoftDim), 37, 39);       // mic ignored
            Assert.Equal(HoldReason.None, co.EvaluateHold(Mic));
            Assert.Equal(HoldReason.Media, co.EvaluateHold(Video));
        }

        [Fact]
        public void MeetingTakesPrecedenceOverMedia()
        {
            var (co, _) = Make(enforcing: true);
            Assert.Equal(HoldReason.Meeting,
                co.EvaluateHold(new PassiveSignals { DisplayRequired = true, CameraInUse = true }));
        }

        [Fact]
        public void LockRefused_DropsTheModelVerdict()
        {
            var (co, p) = Make(enforcing: true);
            var r = Run(co, 0, 60, s => NoSignals);
            Assert.Equal(LockCause.Model, co.PendingLock);
            co.OnLockRefused();
            Assert.Equal(LockCause.None, co.PendingLock);
            Assert.False(co.Engine.EnforcedLockPending);
        }

        [Fact]
        public void WinL_RightAfterInput_IsAManualLockLabel()
        {
            var (co, p) = Make(enforcing: false);
            co.Tick(T0, 0.0, NoSignals, ModePolicy.Auto, Sig);
            co.OnSessionLocked(T0 + Sec, 1.0, Sig);
            Assert.Equal(1, p.Modes.ConfirmedPositives);
            co.OnSessionUnlocked(T0 + 600 * Sec);
            Assert.Equal(CoordinatorAction.None, co.Tick(T0 + 601 * Sec, 0.0, NoSignals, ModePolicy.Auto, Sig).Action);
        }

        /// <summary>
        /// The guarantee the whole design rests on, as a property: for ANY model weights and ANY
        /// pattern of media/meeting signals, an idle enforcing workstation is locked no later than
        /// HoldMax + ConfirmGrace after the last input.
        /// </summary>
        [Fact]
        public void AbsoluteBound_HoldsForRandomModelsAndRandomSignalFlicker()
        {
            var cfg = new CoordinatorConfig();
            int bound = (int)(cfg.HoldMaxSeconds + cfg.ConfirmGraceSeconds) + 1;
            var rnd = new Random(20261112);
            int worst = 0;
            for (int trial = 0; trial < 500; trial++)
            {
                var (co, p) = Make(enforcing: true, cfg: cfg);
                p.Model.W0 = -30 + rnd.NextDouble() * 35;
                p.Model.U0 = -8 + rnd.NextDouble() * 10;
                for (int i = 0; i < FeatureSchema.Count; i++)
                {
                    p.Model.W[i] = rnd.NextDouble() * 10 - 5;
                    p.Model.U[i] = rnd.NextDouble() * 4 - 2;
                }
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
                    var r = co.Tick(T0 + s * Sec, s, sig, ModePolicy.Auto, Sig);
                    if (r.Action == CoordinatorAction.Lock) locked = s;
                }
                Assert.True(locked >= 0 && locked <= bound, $"trial {trial}: locked at {locked}, bound {bound}");
                worst = Math.Max(worst, locked);
            }
            Assert.True(worst <= bound);
        }
    }
}
