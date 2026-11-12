using System;
using System.Diagnostics;
using PresenceLock.App.Interop;

namespace PresenceLock.App.Sensors
{
    /// <summary>
    /// Resolves the current foreground process NAME only (e.g. "inventor"), and maps it
    /// to a behavioural category. Resolving the exe can throw for protected/elevated
    /// processes; that is swallowed and reported as Neutral.
    /// </summary>
    public sealed class ForegroundMonitor
    {
        private readonly AppCategory _categories;

        public ForegroundMonitor(AppCategory categories) { _categories = categories; }

        public string CurrentProcessName()
        {
            try
            {
                IntPtr hwnd = NativeMethods.GetForegroundWindow();
                if (hwnd == IntPtr.Zero) return null;
                NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
                if (pid == 0) return null;
                using (var proc = Process.GetProcessById((int)pid))
                    return proc.ProcessName; // no ".exe", no path, no title
            }
            catch
            {
                return null;
            }
        }

        public ForegroundCategory CurrentCategory() => _categories.Classify(CurrentProcessName());
    }
}
