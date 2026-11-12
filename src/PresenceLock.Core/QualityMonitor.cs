using System;
using System.Linq;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    /// <summary>
    /// Kaizen, the "check" step in enforcing mode: is the agent still as good as when it was
    /// promoted? Two measures, both from facts:
    ///  * false dims: the same 200-episode window and Wilson 95 % upper bound as the promotion gate
    ///    (a dim or lock the user answered within the FP window);
    ///  * unattended time: idle seconds at each of our locks that the user later confirmed by
    ///    unlocking slowly (they were really away), last 50.
    /// Crossing the gate target raises an alert (event log for the administrator); it clears with
    /// hysteresis at 80 % of the target. It NEVER demotes to learning mode or stops locking: in
    /// NIS2 mode that would be a way to switch protection off. The learning itself keeps adapting.
    /// </summary>
    [DataContract]
    public sealed class QualityMonitor
    {
        public const int ExposureWindow = 50;
        [DataMember] public bool Degraded;
        [DataMember] public long DegradedSinceUtcTicks;
        [DataMember] public int Alerts;
        [DataMember] public double[] Exposure = new double[ExposureWindow];
        [DataMember] public int ExposureHead, ExposureCount;
        [DataMember] public double LastUpperBound;

        public enum Change { None, Degraded, Restored }

        public void Normalize()
        {
            if (Exposure == null || Exposure.Length != ExposureWindow) { Exposure = new double[ExposureWindow]; ExposureHead = ExposureCount = 0; }
            if (ExposureHead < 0 || ExposureHead >= ExposureWindow) ExposureHead = 0;
            ExposureCount = Math.Max(0, Math.Min(ExposureWindow, ExposureCount));
        }

        public void RecordExposure(double seconds)
        {
            if (double.IsNaN(seconds) || seconds < 0) return;
            Exposure[ExposureHead] = seconds;
            ExposureHead = (ExposureHead + 1) % ExposureWindow;
            if (ExposureCount < ExposureWindow) ExposureCount++;
        }

        public double ExposureMedian => ExposureCount == 0 ? double.NaN
            : Exposure.Take(ExposureCount).OrderBy(v => v).ElementAt(ExposureCount / 2);
        public double ExposureMax => ExposureCount == 0 ? double.NaN : Exposure.Take(ExposureCount).Max();

        public Change Evaluate(ModeController m, long nowUtcTicks)
        {
            if (m.Mode != OperatingMode.Enforcing || m.WindowCount < ModeController.WindowSize) return Change.None;
            double ub = m.FalsePositiveUpperBound();
            LastUpperBound = ub;
            if (!Degraded && ub > m.TargetFalsePositiveRate)
            {
                Degraded = true;
                DegradedSinceUtcTicks = nowUtcTicks;
                Alerts++;
                return Change.Degraded;
            }
            if (Degraded && ub <= 0.8 * m.TargetFalsePositiveRate)
            {
                Degraded = false;
                return Change.Restored;
            }
            return Change.None;
        }

        public string Describe(ModeController m) => string.Format(System.Globalization.CultureInfo.InvariantCulture,
            "quality: {0}; false dims upper95 {1:P1} (target {2:P0}); alerts {3}; unattended time at confirmed locks: median {4} s, max {5} s (last {6})",
            Degraded ? "BELOW TARGET since " + new DateTime(DegradedSinceUtcTicks, DateTimeKind.Utc).ToString("u") : "ok",
            m.FalsePositiveUpperBound(), m.TargetFalsePositiveRate, Alerts,
            ExposureCount == 0 ? "-" : ExposureMedian.ToString("F0", System.Globalization.CultureInfo.InvariantCulture),
            ExposureCount == 0 ? "-" : ExposureMax.ToString("F0", System.Globalization.CultureInfo.InvariantCulture),
            ExposureCount);
    }
}
