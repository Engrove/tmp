using System;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    /// <summary>
    /// The probability-of-absence model.
    ///
    ///   z(x, t) = w0 + w·x + λ(x)·t,   λ(x) = softplus(u0 + u·x) ≥ 0
    ///   P(away | x, t) = sigmoid(z)
    ///
    /// w·x shifts the baseline; λ(x) is the context-dependent hazard rate that turns
    /// idle seconds into absence probability. A "reading" context learns small λ (it
    /// takes minutes to reach the lock threshold); a "leaving" signature learns large
    /// λ (threshold in seconds).
    ///
    /// The default weights are chosen so that with a neutral context (all x = 0) the
    /// curve is EXACTLY the one the user's own simulation shows:
    ///   P(t) = sigmoid(-3.0 + 0.11·t)  ->  75% at 37.3 s, 90% at 47.2 s.
    /// Learning then bends this per context.
    ///
    /// Training is single-example online logistic SGD. Gradients (log-loss):
    ///   dL/dz = P - y
    ///   g_w0  = (P-y)
    ///   g_wi  = (P-y)·x_i
    ///   g_u0  = (P-y)·t·σ(a)
    ///   g_ui  = (P-y)·t·σ(a)·x_i          where a = u0 + u·x
    /// </summary>
    [DataContract]
    public sealed class PresenceModel
    {
        // Not readonly: DataContractJsonSerializer must be able to assign these on load.
        [DataMember] public double W0;
        [DataMember] public double[] W;   // length FeatureSchema.Count
        [DataMember] public double U0;
        [DataMember] public double[] U;   // length FeatureSchema.Count

        // Hyper-parameters (overridable via policy; sane defaults here).
        [DataMember] public double LearningRate = 0.05;
        [DataMember] public double L2 = 1e-4;
        [DataMember] public double GradClip = 5.0;
        [DataMember] public double RateParamClip = 6.0; // clamp 'a' so λ cannot explode

        /// <summary>softplus^-1(0.11) so the neutral baseline reproduces the reference sim.</summary>
        public const double DefaultU0 = -2.15173;
        public const double DefaultW0 = -3.0;

        public PresenceModel()
        {
            W = new double[FeatureSchema.Count];
            U = new double[FeatureSchema.Count];
            W0 = DefaultW0;
            U0 = DefaultU0;
        }

        /// <summary>Context hazard λ(x) = softplus(clamp(u0 + u·x)).</summary>
        public double Hazard(double[] x)
        {
            double a = U0;
            for (int i = 0; i < FeatureSchema.Count; i++) a += U[i] * x[i];
            a = MathUtil.Clamp(a, -RateParamClip, RateParamClip);
            return MathUtil.Softplus(a);
        }

        public double Probability(double[] x, double idleSeconds)
        {
            double z = W0;
            for (int i = 0; i < FeatureSchema.Count; i++) z += W[i] * x[i];
            z += Hazard(x) * idleSeconds;
            return MathUtil.Sigmoid(z);
        }

        public double Probability(FeatureVector f) => Probability(f.X, f.IdleSeconds);

        /// <summary>
        /// Idle seconds at which P(away) first reaches <paramref name="target"/> for context x,
        /// capped at <paramref name="tMax"/>. P is monotone in t because λ ≥ 0, so bisection
        /// is exact to ~tMax/2^50. Used for the decision-level stability metric and diagnostics.
        /// </summary>
        public double LockTime(double[] x, double target, double tMax = 600.0)
        {
            if (Probability(x, 0.0) >= target) return 0.0;
            if (Probability(x, tMax) < target) return tMax;
            double lo = 0.0, hi = tMax;
            for (int k = 0; k < 50; k++)
            {
                double mid = 0.5 * (lo + hi);
                if (Probability(x, mid) >= target) hi = mid; else lo = mid;
            }
            return hi;
        }

        /// <summary>
        /// One SGD step on a labelled sample. Returns the magnitude of the parameter
        /// change (L1), which the ModeController uses as a stability signal.
        /// </summary>
        public double Update(FeedbackSample s)
        {
            double[] x = s.Features.X;
            double t = s.Features.IdleSeconds;

            double a = U0;
            for (int i = 0; i < FeatureSchema.Count; i++) a += U[i] * x[i];
            a = MathUtil.Clamp(a, -RateParamClip, RateParamClip);
            double lam = MathUtil.Softplus(a);
            double sigA = MathUtil.Sigmoid(a); // d softplus / d a

            double z = W0;
            for (int i = 0; i < FeatureSchema.Count; i++) z += W[i] * x[i];
            z += lam * t;
            double p = MathUtil.Sigmoid(z);

            double err = (p - s.Label) * s.Weight; // dL/dz scaled by importance
            double lr = LearningRate;
            double change = 0.0;

            // Bias terms are not L2-regularised.
            double gW0 = MathUtil.ClipAbs(err, GradClip);
            double dW0 = lr * gW0;
            W0 -= dW0; change += Math.Abs(dW0);

            double tSig = t * sigA;
            double gU0 = MathUtil.ClipAbs(err * tSig, GradClip);
            double dU0 = lr * gU0;
            U0 -= dU0; change += Math.Abs(dU0);

            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                double xi = x[i];
                double gWi = MathUtil.ClipAbs(err * xi, GradClip) + L2 * W[i];
                double dWi = lr * gWi;
                W[i] -= dWi; change += Math.Abs(dWi);

                double gUi = MathUtil.ClipAbs(err * tSig * xi, GradClip) + L2 * U[i];
                double dUi = lr * gUi;
                U[i] -= dUi; change += Math.Abs(dUi);
            }

            return change;
        }

        public PresenceModel DeepCopy()
        {
            var m = new PresenceModel
            {
                W0 = W0, U0 = U0, LearningRate = LearningRate, L2 = L2,
                GradClip = GradClip, RateParamClip = RateParamClip
            };
            Array.Copy(W, m.W, W.Length);
            Array.Copy(U, m.U, U.Length);
            return m;
        }
    }
}
