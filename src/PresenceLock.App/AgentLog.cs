using System;
using System.Globalization;
using System.IO;
using System.Text;
using PresenceLock.Core;

namespace PresenceLock.App
{
    /// <summary>
    /// Tiny local diagnostic log for administrators: %LOCALAPPDATA%\PresenceLock\agent.log.
    /// Records lifecycle events, mode changes and errors only — never input, process names,
    /// window titles or anything else about what the user is doing. Rotates at 256 KB.
    /// </summary>
    internal static class AgentLog
    {
        private static readonly RotatingLog Log = new RotatingLog(Path.Combine(ProfileStore.DefaultDirectory(), "agent.log"));

        public static string PathName => Log.PathName;

        /// <summary>
        /// Disk budget: agent.log + agent.log.1, at most 256 KB each; a line is cut at 2048
        /// characters; the same message at most once per 10 minutes (with a repeat count).
        /// </summary>
        public static void Write(string message)
        {
            try { Log.Write(message, DateTime.Now, DateTime.UtcNow.Ticks); }
            catch { /* logging must never take the agent down */ }
        }

        /// <summary>Retire lines older than the retention period (cleaning service).</summary>
        public static int Retire(int days)
        {
            try { return Log.Retire(DateTime.Now.AddDays(-days)); }
            catch { return 0; }
        }
    }

    /// <summary>
    /// Application event log entries from the agent (source "PresenceLock", registered by
    /// Install-PresenceLock.ps1; a standard user may write to it but not create it). Stable IDs for
    /// SIEM rules. Content is aggregate quality figures only — nothing about what the user does.
    ///   1010 quality below target (false dims above the gate target in enforcing mode)
    ///   1011 quality back within target
    ///   1012 a learned model change made predictions significantly worse and was rolled back
    ///   1013 profile.json unusable: restored from the last-known-good backup (or started fresh)
    ///   1014 habits.json unusable: a new journal was started (locking unaffected)
    ///   1015 the user started a pause (length, budget left)   - audit: never throttled (the budget bounds it)
    ///   1016 the pause ended (ran out / ended by the user)       - audit: never throttled
    ///   1017 a lock request was refused or not confirmed: requested again / fallback disconnect
    ///   1018 a signal the security loop depends on failed (idle time, raw input, session notifications)
    /// </summary>
    internal static class AgentEvents
    {
        public const int QualityBelowTarget = 1010, QualityRestored = 1011, ModelRolledBack = 1012,
                         ProfileRecovered = 1013, JournalReset = 1014, PauseStarted = 1015, PauseEnded = 1016,
                         LockNotConfirmed = 1017, SignalDegraded = 1018;

        private static readonly EventThrottle Throttle = new EventThrottle();
        private static readonly TimeSpan Window = TimeSpan.FromHours(1);

        /// <summary>At most one entry per event id per hour, with a count of the suppressed ones.</summary>
        public static void Write(int id, System.Diagnostics.EventLogEntryType type, string message, bool throttle = true)
        {
            int suppressed = 0;
            if (throttle && !Throttle.ShouldEmit(id.ToString(System.Globalization.CultureInfo.InvariantCulture), DateTime.UtcNow.Ticks, Window, out suppressed)) return;
            if (throttle) message = EventThrottle.WithSuppressed(message, suppressed, Window);
            AgentLog.Write("event " + id + ": " + message);
            try
            {
                if (System.Diagnostics.EventLog.SourceExists("PresenceLock"))
                    System.Diagnostics.EventLog.WriteEntry("PresenceLock",
                        message + " (user " + Environment.UserDomainName + "\\" + Environment.UserName + ")", type, id);
            }
            catch { /* event log unavailable: the local agent.log line is the fallback */ }
        }
    }
}
