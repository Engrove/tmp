using System;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    /// <summary>
    /// Continuous improvement with verification (Kaizen: measure, adjust, check).
    ///
    /// The live model keeps learning from every factual label for as long as the agent runs —
    /// the 15-30-day learning period only decides when to START locking. Online learning can also
    /// drift the wrong way (an unlucky run of labels, a burst of one kind of label). The guard keeps
    /// the last model that proved itself (the "champion") and scores BOTH models on every new label
    /// BEFORE the live model learns from it (prequential: neither has seen the label). Log-loss is a
    /// proper scoring rule, so a model cannot win by being over- or under-confident.
    ///
    /// Every <see cref="ModelGuardPolicy.BlockSize"/> labels (paired, weighted like training):
    ///   live significantly WORSE (mean loss difference &gt; Z standard errors) -&gt; roll back: the
    ///       live weights are replaced by the champion's (hyper-parameters stay);
    ///   live at least as good                                              -&gt; it becomes champion;
    ///   undecided                                                          -&gt; keep collecting; after
    ///       MaxBlocks blocks without significant harm the live model is accepted (it may be adapting
    ///       to a real change in the user's habits, which an old champion cannot follow).
    /// Not part of the learning algorithm itself (which is verified bit-exact against the Python
    /// reference); it supervises it.
    /// </summary>
    [DataContract]
    public sealed class ModelGuard
    {
        [DataMember] public PresenceModel Champion;
        [DataMember] public double SumW, SumWD, SumWD2;
        [DataMember] public int Count;
        [DataMember] public int Promotions;
        [DataMember] public int Rollbacks;
        [DataMember] public long LastRollbackUtcTicks;
        [DataMember] public double LastMeanDifference;   // live - champion log-loss per weight, last decision
        [DataMember] public double LastZ;

        public void Normalize()
        {
            if (Champion != null && (Champion.W == null || Champion.U == null
                || Champion.W.Length != FeatureSchema.Count || Champion.U.Length != FeatureSchema.Count))
                Champion = null;
            if (double.IsNaN(SumW) || double.IsNaN(SumWD) || double.IsNaN(SumWD2) || Count < 0) Reset();
        }

        private void Reset() { SumW = SumWD = SumWD2 = 0; Count = 0; }

        public static double LogLoss(double p, double y)
        {
            p = MathUtil.Clamp(p, 1e-6, 1 - 1e-6);
            return -(y * Math.Log(p) + (1 - y) * Math.Log(1 - p));
        }

        /// <summary>Call BEFORE the live model learns from <paramref name="s"/>.</summary>
        public void Score(PresenceModel live, FeedbackSample s)
        {
            if (Champion == null) Champion = live.DeepCopy();
            double t = s.Features.IdleSeconds;
            double d = LogLoss(live.Probability(s.Features.X, t), s.Label)
                     - LogLoss(Champion.Probability(s.Features.X, t), s.Label);
            if (double.IsNaN(d) || double.IsInfinity(d)) return;
            SumW += s.Weight;
            SumWD += s.Weight * d;
            SumWD2 += s.Weight * d * d;
            Count++;
        }

        public enum Verdict { None, Promoted, RolledBack }

        /// <summary>Call AFTER the live model learned. May overwrite the live weights (roll back).</summary>
        public Verdict Decide(PresenceModel live, long nowUtcTicks, ModelGuardPolicy p)
        {
            // Decide only at block boundaries: at most MaxBlocks looks per decision, so repeated
            // testing cannot inflate the false-rollback rate (MaxBlocks x one-sided P(z > Z)).
            if (Count < p.BlockSize || Count % p.BlockSize != 0 || SumW <= 0) return Verdict.None;
            double mean = SumWD / SumW;
            double var = Math.Max(0, SumWD2 / SumW - mean * mean);
            double se = Math.Sqrt(var / Count);
            double z = se > 0 ? mean / se : (mean > 0 ? double.PositiveInfinity : 0);
            // Roll back only on a regression that is BOTH statistically significant and material:
            // with a constant learning rate the live model always jitters around its optimum
            // (measured: block means of ~0.01-0.02 nats on a user whose habits do not change);
            // replacing it for that would be noise, not improvement.
            if (mean > p.MinHarm && z > p.Z)
            {
                CopyWeights(Champion, live);
                Rollbacks++;
                LastRollbackUtcTicks = nowUtcTicks;
                Finish(mean, z);
                return Verdict.RolledBack;
            }
            if (mean <= 0 || Count >= p.BlockSize * p.MaxBlocks)
            {
                Champion = live.DeepCopy();
                Promotions++;
                Finish(mean, z);
                return Verdict.Promoted;
            }
            return Verdict.None;   // worse but not significantly: keep collecting
        }

        private void Finish(double mean, double z)
        {
            LastMeanDifference = mean;
            LastZ = z;
            SumW = SumWD = SumWD2 = 0;
            Count = 0;
        }

        private static void CopyWeights(PresenceModel from, PresenceModel to)
        {
            to.W0 = from.W0;
            to.U0 = from.U0;
            Array.Copy(from.W, to.W, to.W.Length);
            Array.Copy(from.U, to.U, to.U.Length);
        }

        public string Describe() => string.Format(System.Globalization.CultureInfo.InvariantCulture,
            "model guard: champion {0}, promotions {1}, rollbacks {2}{3}; collecting {4} labels; last decision: live-champion log-loss {5:+0.000;-0.000;0.000} (z {6:F1})",
            Champion == null ? "none yet" : "kept", Promotions, Rollbacks,
            LastRollbackUtcTicks != 0 ? string.Format(System.Globalization.CultureInfo.InvariantCulture, " (last {0:u})", new DateTime(LastRollbackUtcTicks, DateTimeKind.Utc)) : "",
            Count, LastMeanDifference, LastZ);
    }

    public sealed class ModelGuardPolicy
    {
        public int BlockSize = 40;   // labels per decision
        public int MaxBlocks = 4;    // undecided this long: accept the live model
        public double Z = 2.5;       // one-sided 0.6 % per look; <= 2.5 % over MaxBlocks looks
        public double MinHarm = 0.05; // nats per label (~5 % lower likelihood): smaller is SGD jitter
    }
}
