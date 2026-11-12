using System;
using PresenceLock.Core;
using Xunit;

namespace PresenceLock.Core.Tests
{
    public class EngineTests
    {
        private const long Sec = TimeSpan.TicksPerSecond;
        private const long T0 = UserSim.BaseTicks;

        private static double[] Zeros() => new double[FeatureSchema.Count];

        // ---- 1. baseline == the user's own simulation ---------------------------------
        [Fact]
        public void NeutralBaseline_Reproduces_ReferenceSimulation()
        {
            var m = new PresenceModel();
            Assert.InRange(m.Hazard(Zeros()), 0.1099, 0.1101);
            Assert.InRange(m.LockTime(Zeros(), 0.75), 36.9, 37.7);   // sim: 37.3 s
            Assert.InRange(m.LockTime(Zeros(), 0.90), 46.8, 47.6);   // sim: 47.2 s
        }

        // ---- 2. the implemented SGD step IS the gradient of the log-loss ---------------
        private static double LogLoss(PresenceModel m, double[] x, double t, double y)
        {
            double p = Math.Min(Math.Max(m.Probability(x, t), 1e-15), 1 - 1e-15);
            return -(y * Math.Log(p) + (1 - y) * Math.Log(1 - p));
        }

        [Fact]
        public void Update_Implements_TheTrueLogLossGradient()
        {
            var rnd = new Random(7);
            var m = new PresenceModel { L2 = 0.0, LearningRate = 1e-7 };
            m.W0 = rnd.NextDouble() * 2 - 1; m.U0 = -2 + rnd.NextDouble() * 2;
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                m.W[i] = rnd.NextDouble() - 0.5; m.U[i] = 0.6 * rnd.NextDouble() - 0.3;
            }
            var f = new FeatureVector();
            for (int i = 0; i < FeatureSchema.Count; i++) f.X[i] = rnd.NextDouble() * 2 - 1;
            f.IdleSeconds = 5 + rnd.NextDouble() * 55;
            const double y = 1.0;

            // numeric gradient of the loss, parameter by parameter
            const double eps = 1e-6;
            Func<PresenceModel, double> L = mm => LogLoss(mm, f.X, f.IdleSeconds, y);
            double Num(Action<PresenceModel, double> nudge)
            {
                var a = m.DeepCopy(); nudge(a, +eps);
                var b = m.DeepCopy(); nudge(b, -eps);
                return (L(a) - L(b)) / (2 * eps);
            }
            var numW0 = Num((mm, d) => mm.W0 += d);
            var numU0 = Num((mm, d) => mm.U0 += d);
            var numW = new double[FeatureSchema.Count];
            var numU = new double[FeatureSchema.Count];
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                int k = i;
                numW[k] = Num((mm, d) => mm.W[k] += d);
                numU[k] = Num((mm, d) => mm.U[k] += d);
            }

            // implied gradient of one real Update() step
            var before = m.DeepCopy();
            m.Update(new FeedbackSample { Features = f, Label = y, Weight = 1.0 });
            double lr = m.LearningRate, worst = 0;
            worst = Math.Max(worst, Math.Abs((before.W0 - m.W0) / lr - numW0));
            worst = Math.Max(worst, Math.Abs((before.U0 - m.U0) / lr - numU0));
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                worst = Math.Max(worst, Math.Abs((before.W[i] - m.W[i]) / lr - numW[i]));
                worst = Math.Max(worst, Math.Abs((before.U[i] - m.U[i]) / lr - numU[i]));
            }
            Assert.True(worst < 1e-5, $"implemented step deviates from the gradient by {worst:E2}");
        }

        // ---- 3 / 4. direction of learning ------------------------------------------------
        [Fact]
        public void FalsePositives_MakeTheModelWaitLonger()
        {
            var m = new PresenceModel();
            var f = UserSim.ReadingSig(); f.IdleSeconds = 48;
            double before = m.LockTime(f.X, 0.9);
            for (int k = 0; k < 40; k++) m.Update(FeedbackSample.From(f, FeedbackKind.FalsePositive, T0));
            Assert.True(m.LockTime(f.X, 0.9) - before >= 30.0);
        }

        [Fact]
        public void ManualLocks_MakeTheModelLockSooner()
        {
            var m = new PresenceModel();
            var f = UserSim.LeavingSig(); f.IdleSeconds = 1;
            double before = m.LockTime(f.X, 0.9);
            for (int k = 0; k < 40; k++) m.Update(FeedbackSample.From(f, FeedbackKind.ManualLock, T0));
            Assert.True(before - m.LockTime(f.X, 0.9) >= 15.0);
        }

        // ---- 7. enforced lock judged by unlock delta ------------------------------------
        private static long DriveToLock(PresenceEngine e, FeatureVector sig, long now)
        {
            e.BeginEpisode(sig, now);
            for (int s = 1; s < 120; s++)
            {
                e.UpdateLive(s);
                if (e.Tick(now + s * Sec).Action == DecisionAction.TriggerLock) return now + s * Sec;
            }
            return -1;
        }

        [Fact]
        public void EnforcedLock_QuickUnlock_BacksOff_LongUnlock_Reinforces()
        {
            var p1 = new UserProfile(); p1.Modes.Mode = OperatingMode.Enforcing;
            var e1 = new PresenceEngine(p1);
            long lk = DriveToLock(e1, UserSim.LeavingSig(), T0);
            Assert.True(lk > 0);
            Assert.True(e1.EnforcedLockPending);
            Assert.False(e1.EpisodeActive);                       // no double counting
            double b = p1.Model.LockTime(UserSim.LeavingSig().X, 0.9);
            e1.ApplyEnforcedLockOutcome(lk + 4 * Sec);
            Assert.True(p1.Model.LockTime(UserSim.LeavingSig().X, 0.9) > b);
            Assert.False(e1.EnforcedLockPending);

            var p2 = new UserProfile(); p2.Modes.Mode = OperatingMode.Enforcing;
            var e2 = new PresenceEngine(p2);
            lk = DriveToLock(e2, UserSim.LeavingSig(), T0);
            b = p2.Model.LockTime(UserSim.LeavingSig().X, 0.9);
            e2.ApplyEnforcedLockOutcome(lk + 600 * Sec);
            Assert.True(p2.Model.LockTime(UserSim.LeavingSig().X, 0.9) <= b + 1e-9);
        }

        // ---- 8. learning mode: invisible decisions, user flag ---------------------------
        [Fact]
        public void LearningMode_NeverLocks_AndUserFlagTeachesOnce()
        {
            var p = new UserProfile();
            var e = new PresenceEngine(p);
            long lk = DriveToLock(e, UserSim.ReadingSig(), T0);
            Assert.True(lk > 0);
            Assert.Equal(OperatingMode.Learning, e.Mode);
            Assert.False(e.EnforcedLockPending);                  // nothing real was locked

            e.OnInputResumed(lk + 20 * Sec);                      // outside FP window
            double b = p.Model.LockTime(UserSim.ReadingSig().X, 0.9);
            Assert.True(e.OnUserFlaggedUnjustified(lk + 25 * Sec));
            Assert.True(p.Model.LockTime(UserSim.ReadingSig().X, 0.9) > b);
            Assert.False(e.OnUserFlaggedUnjustified(lk + 30 * Sec)); // only once

            var e3 = new PresenceEngine(new UserProfile());
            lk = DriveToLock(e3, UserSim.ReadingSig(), T0);
            e3.OnInputResumed(lk + 2 * Sec);                      // already an automatic FP
            Assert.False(e3.OnUserFlaggedUnjustified(lk + 5 * Sec));
        }

        [Fact]
        public void LearningMode_UnverifiedFire_CountsAgainstPromotion()
        {
            var p = new UserProfile();
            var e = new PresenceEngine(p);
            long lk = DriveToLock(e, UserSim.ReadingSig(), T0);
            e.OnInputResumed(lk + 40 * Sec);
            Assert.Equal(1, p.Modes.WindowFalsePositives());
        }

        [Fact]
        public void LongAbsence_IsCensored_LabelledAtObservedIdle_NotBackdated()
        {
            var p = new UserProfile();
            var e = new PresenceEngine(p);
            var sig = UserSim.ReadingSig();
            double earlyBefore = p.Model.Probability(sig.X, 5.0);
            e.BeginEpisode(sig, T0);
            e.UpdateLive(180);
            e.OnLongAbsence(T0 + 180 * Sec);
            // A label at t=180 must move P(180) up far more than P(5): back-dating to t0
            // would have done the opposite and taught "reading means leaving".
            double dLate = p.Model.Probability(sig.X, 180.0);
            double dEarly = p.Model.Probability(sig.X, 5.0) - earlyBefore;
            Assert.True(dLate > 0.99);
            Assert.True(dEarly < 0.05, $"early probability moved by {dEarly:F3}");
        }

        // ---- optional sensors never decide in enforcing mode unless confirmed ------------
        [Fact]
        public void Enforcing_IgnoresUnconfirmedOptionalSensor()
        {
            var p = new UserProfile();
            p.Model.W[FeatureSchema.AudioDopplerAway] = 10.0;
            var sig = new FeatureVector();
            sig.X[FeatureSchema.AudioDopplerAway] = 1.0;
            sig.Available[FeatureSchema.AudioDopplerAway] = true;

            var learn = new PresenceEngine(p);
            learn.BeginEpisode(sig, T0); learn.UpdateLive(1);
            double pLearning = learn.Tick(T0 + Sec).Probability;

            p.Modes.Mode = OperatingMode.Enforcing;
            var enf = new PresenceEngine(p);
            enf.BeginEpisode(sig, T0); enf.UpdateLive(1);
            double pEnforcingUnconfirmed = enf.Tick(T0 + Sec, ModePolicy.ForceEnforcing).Probability;

            double pNeutral = p.Model.Probability(Zeros(), 1.0);
            Assert.True(pLearning > 0.99);                                  // used while learning
            Assert.Equal(pNeutral, pEnforcingUnconfirmed, 12);             // masked when enforcing

            p.OptionalSeen[FeatureSchema.AudioDopplerAway] = 100;          // now proven reliable
            p.OptionalAvailable[FeatureSchema.AudioDopplerAway] = 95;
            enf.BeginEpisode(sig, T0); enf.UpdateLive(1);
            Assert.True(enf.Tick(T0 + Sec, ModePolicy.ForceEnforcing).Probability > 0.99);
        }

    }
}
