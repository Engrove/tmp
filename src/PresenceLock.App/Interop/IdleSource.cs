using System;

namespace PresenceLock.App.Interop
{
    /// <summary>
    /// The idle time the security logic runs on. GetLastInputInfo is the source; if it fails, the
    /// idle time keeps GROWING from the last successful reading (no input assumed: fail-closed), and
    /// raw mouse input, which arrives independently, still counts as activity. The failure is
    /// reported (degraded) so it becomes a visible event instead of silent "always active".
    /// </summary>
    internal static class IdleSource
    {
        private static long _lastInputMono = MonoClock.NowTicks;
        public static bool Degraded { get; private set; }
        public static int ConsecutiveFailures { get; private set; }

        public static double Read()
        {
            long now = MonoClock.NowTicks;
            double v = NativeMethods.IdleSecondsOrNaN();
            if (!double.IsNaN(v))
            {
                _lastInputMono = Math.Max(_lastInputMono, now - (long)(v * TimeSpan.TicksPerSecond));
                ConsecutiveFailures = 0;
                Degraded = false;
                return v;
            }
            ConsecutiveFailures++;
            Degraded = true;
            return Math.Max(0, (now - _lastInputMono) / (double)TimeSpan.TicksPerSecond);
        }

        /// <summary>Raw mouse input proves activity even when GetLastInputInfo does not answer.</summary>
        public static void NoteRawInput() => _lastInputMono = MonoClock.NowTicks;
    }
}
