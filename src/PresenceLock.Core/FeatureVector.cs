using System;

namespace PresenceLock.Core
{
    /// <summary>
    /// An immutable snapshot of the context signature captured at the moment input
    /// stopped, plus the live idle time. The engine stores one of these per idle
    /// episode in a ring buffer so that later ground-truth (unlock delta, manual
    /// Win+L, long absence) can be attributed back to the exact signals that led to
    /// a decision.
    /// </summary>
    public sealed class FeatureVector
    {
        public readonly double[] X;        // length FeatureSchema.Count
        public double IdleSeconds;         // mutable: grows while the episode stays idle
        public readonly bool[] Available;  // which sensors actually produced this feature

        public FeatureVector()
        {
            X = new double[FeatureSchema.Count];
            Available = new bool[FeatureSchema.Count];
            // Core features are always available; optional default to false.
            for (int i = 0; i < FeatureSchema.Count; i++)
                Available[i] = !FeatureSchema.Optional[i];
        }

        private FeatureVector(double[] x, bool[] avail, double idle)
        {
            X = x; Available = avail; IdleSeconds = idle;
        }

        /// <summary>
        /// Return a copy with optional features that are not present in <paramref name="allowedMask"/>
        /// forced to 0. Used in enforcing mode so a sensor that was available during
        /// learning but is gone now cannot silently swing the decision.
        /// </summary>
        public FeatureVector Masked(bool[] allowedMask)
        {
            var x = (double[])X.Clone();
            var a = (bool[])Available.Clone();
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                if (FeatureSchema.Optional[i] && (!allowedMask[i] || !Available[i]))
                {
                    x[i] = 0.0;
                    a[i] = false;
                }
            }
            return new FeatureVector(x, a, IdleSeconds);
        }

        public FeatureVector Clone()
        {
            return new FeatureVector((double[])X.Clone(), (bool[])Available.Clone(), IdleSeconds);
        }
    }
}
