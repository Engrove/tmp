using System;

namespace PresenceLock.App.Sensors
{
    /// <summary>
    /// A bounded [0,1] prior that this time of day tends to precede a departure. The
    /// baseline is a smooth heuristic peaking around the usual break boundaries; the
    /// model's weight on this feature is then learned per user, so the exact shape does
    /// not have to be perfect. Can be upgraded to a persisted per-half-hour histogram
    /// without touching the model (the feature index is stable).
    /// </summary>
    public sealed class TimePrior
    {
        // Minutes-of-day around which people commonly step away.
        private static readonly int[] PeaksMin = { 9 * 60, 12 * 60, 15 * 60, 17 * 60 };
        private const double SigmaMin = 25.0;

        public double Value(DateTime localNow)
        {
            int m = localNow.Hour * 60 + localNow.Minute;
            double best = 0.0;
            foreach (int p in PeaksMin)
            {
                double d = m - p;
                double g = Math.Exp(-(d * d) / (2 * SigmaMin * SigmaMin));
                if (g > best) best = g;
            }
            return best; // already in (0,1]
        }
    }
}
