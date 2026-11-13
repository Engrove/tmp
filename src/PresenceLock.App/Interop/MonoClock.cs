using System.Diagnostics;

namespace PresenceLock.App.Interop
{
    /// <summary>Monotonic time in 100 ns ticks (QueryPerformanceCounter): unaffected by clock changes.</summary>
    internal static class MonoClock
    {
        private static readonly double Scale = 10_000_000.0 / Stopwatch.Frequency;
        public static long NowTicks => (long)(Stopwatch.GetTimestamp() * Scale);
    }
}
