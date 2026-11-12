using System;

namespace PresenceLock.Core
{
    /// <summary>
    /// Numerically-stable scalar helpers shared by the inference and learning code.
    /// Kept deliberately dependency-free (no System.Math.NET etc.) so the whole
    /// Core assembly compiles against the in-box net48 reference assemblies only.
    /// </summary>
    public static class MathUtil
    {
        /// <summary>Logistic sigmoid, overflow-safe for large |x|.</summary>
        public static double Sigmoid(double x)
        {
            if (x >= 0.0)
            {
                double z = Math.Exp(-x);
                return 1.0 / (1.0 + z);
            }
            else
            {
                double z = Math.Exp(x);
                return z / (1.0 + z);
            }
        }

        /// <summary>softplus(x) = ln(1 + e^x), overflow-safe. Always &gt; 0.</summary>
        public static double Softplus(double x)
        {
            // For large x, softplus(x) -> x; for very negative x -> e^x.
            if (x > 30.0) return x;
            if (x < -30.0) return Math.Exp(x);
            return MathCompat.Log1p(Math.Exp(x));
        }

        /// <summary>Clamp helper (net48 has no Math.Clamp for double on all targets).</summary>
        public static double Clamp(double v, double lo, double hi)
        {
            if (v < lo) return lo;
            if (v > hi) return hi;
            return v;
        }

        /// <summary>Clip a value symmetrically to [-limit, limit] to keep SGD stable.</summary>
        public static double ClipAbs(double v, double limit)
        {
            if (v > limit) return limit;
            if (v < -limit) return -limit;
            return v;
        }
    }

    // net48's System.Math has no Log1p; provide a stable local version.
    internal static class MathCompat
    {
        public static double Log1p(this double x) => Log1pImpl(x);

        private static double Log1pImpl(double x)
        {
            // ln(1+x) accurate for small x.
            if (x <= -1.0) return double.NegativeInfinity;
            double u = 1.0 + x;
            if (u == 1.0) return x;              // x so small it vanished
            return Math.Log(u) * (x / (u - 1.0)); // correction factor for small x
        }
    }
}
