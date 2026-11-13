using System;

namespace PresenceLock.Core
{
    /// <summary>One raw mouse event. <see cref="TimestampTicks"/> is on the host's MONOTONIC clock (100 ns units).</summary>
    public struct RawInputSample
    {
        public int Dx;
        public int Dy;
        public int WheelDelta;   // 0 unless a wheel event
        public long TimestampTicks;
    }

    /// <summary>
    /// Keeps a short rolling window of raw MOUSE events and derives the
    /// kinematic "departure signature" at the instant input stops. Everything here is
    /// relative movement counts and timing — no coordinates are stored beyond the final
    /// cursor position used for edge detection, and nothing is ever persisted.
    ///
    /// The heuristics below are deliberately simple and bounded to [0,1]; they only need
    /// to be *informative*, because the model learns how much to trust each one per
    /// context. They are documented and tunable rather than magic.
    /// </summary>
    public sealed class KinematicsTracker
    {
        private const int WindowMs = 3000;
        private const int Capacity = 512;

        private struct Ev { public long T; public double Speed; public bool Wheel; public int Dx; public int Dy; }

        private readonly Ev[] _buf = new Ev[Capacity];
        private int _head, _count;

        // Tunables.
        public double HighSpeed = 40.0;     // raw-count magnitude considered "fast"
        public int EdgeMarginPx = 8;

        public void Feed(RawInputSample s)
        {
            double speed = Math.Sqrt((double)s.Dx * s.Dx + (double)s.Dy * s.Dy);
            _buf[_head] = new Ev
            {
                T = s.TimestampTicks, Speed = speed, Wheel = s.WheelDelta != 0,
                Dx = s.Dx, Dy = s.Dy
            };
            _head = (_head + 1) % Capacity;
            if (_count < Capacity) _count++;
        }

        private int Index(int k) => (_head - _count + k + Capacity) % Capacity;

        /// <summary>The mouse must have been the input that stopped: its last event at most this long before the last input.</summary>
        public double MaxMouseLagSeconds = 1.5;

        /// <summary>
        /// Write the five kinematic features into the signature. <paramref name="cursorX"/>/Y
        /// is the final cursor position; screen bounds are used for edge-fling detection.
        /// <paramref name="nowTicks"/> is on the same monotonic clock as the samples and
        /// <paramref name="idleSeconds"/> is the current idle time: if the mouse was not the input
        /// that just stopped (keyboard work after the last mouse move, or stale data), NO kinematic
        /// features are written — an old gesture must not describe a new episode.
        /// </summary>
        public void WriteFeatures(FeatureVector fv, int cursorX, int cursorY,
                                  int screenLeft, int screenTop, int screenRight, int screenBottom,
                                  long nowTicks, double idleSeconds)
        {
            var cursor = new { X = cursorX, Y = cursorY };
            if (_count == 0) return;
            long newest = _buf[Index(_count - 1)].T;
            long lastInput = nowTicks - (long)(Math.Max(0, idleSeconds) * TimeSpan.TicksPerSecond);
            if (newest > nowTicks || newest < lastInput - (long)(MaxMouseLagSeconds * TimeSpan.TicksPerSecond)) return;
            long cutoff = newest - (long)WindowMs * TimeSpan.TicksPerMillisecond;

            int total = 0, wheel = 0, mouseCount = 0;
            double maxSpeedLate = 0.0;      // last 200 ms
            int lateSamples = 0;
            long lateCutoff = newest - 200 * TimeSpan.TicksPerMillisecond;

            // Collect the last few mouse speeds for a decel trend.
            double lastSpeed = 0.0, prevSpeed = 0.0;
            long lastMouseT = 0, prevMouseT = 0;
            int lastDx = 0, lastDy = 0; double lastMag = 0;

            for (int k = 0; k < _count; k++)
            {
                var e = _buf[Index(k)];
                if (e.T < cutoff) continue;
                total++;
                if (e.Wheel) wheel++;
                mouseCount++;
                prevSpeed = lastSpeed; prevMouseT = lastMouseT;
                lastSpeed = e.Speed; lastMouseT = e.T;
                lastDx = e.Dx; lastDy = e.Dy; lastMag = e.Speed;
                if (e.T >= lateCutoff) { lateSamples++; if (e.Speed > maxSpeedLate) maxSpeedLate = e.Speed; }
            }

            if (total == 0) return;

            // 1) scroll fraction
            fv.X[FeatureSchema.ScrollFrac] = (double)wheel / total;

            // 2) deceleration: smooth slowdown => prevSpeed high, lastSpeed low, both present
            if (prevSpeed > 1.0)
                fv.X[FeatureSchema.Deceleration] = MathClamp01((prevSpeed - lastSpeed) / prevSpeed);

            // 3) abrupt stop: fast motion very recently, then essentially nothing after
            bool wasFast = maxSpeedLate >= HighSpeed;
            bool sparseAfter = lateSamples <= 2;
            fv.X[FeatureSchema.AbruptStop] = (wasFast && sparseAfter) ? 1.0 : 0.0;

            // 4) edge fling: last motion heads toward a screen edge and cursor ends on it
            double edge = 0.0;
            if (lastMag >= HighSpeed * 0.5)
            {
                if (lastDx > 0 && cursor.X >= screenRight - EdgeMarginPx) edge = 1.0;
                else if (lastDx < 0 && cursor.X <= screenLeft + EdgeMarginPx) edge = 1.0;
                if (lastDy > 0 && cursor.Y >= screenBottom - EdgeMarginPx) edge = 1.0;
                else if (lastDy < 0 && cursor.Y <= screenTop + EdgeMarginPx) edge = 1.0;
            }
            fv.X[FeatureSchema.EdgeFling] = edge;

            // 5) micro jerk: a tiny 1-3px twitch released after a gap (hand leaving mouse)
            double gapMs = (lastMouseT - prevMouseT) / (double)TimeSpan.TicksPerMillisecond;
            bool tiny = lastMag >= 1.0 && lastMag <= 3.0;
            fv.X[FeatureSchema.MicroJerk] = (tiny && gapMs > 300.0) ? 1.0 : 0.0;
        }

        private static double MathClamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

        public void Clear() { _head = 0; _count = 0; }
    }
}
