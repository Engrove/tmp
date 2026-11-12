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
        private const long MaxBytes = 256 * 1024;
        private static readonly object Gate = new object();

        public static string PathName => Path.Combine(ProfileStore.DefaultDirectory(), "agent.log");

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(ProfileStore.DefaultDirectory());
                    var fi = new FileInfo(PathName);
                    if (fi.Exists && fi.Length > MaxBytes)
                    {
                        string old = PathName + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(PathName, old);
                    }
                    File.AppendAllText(PathName,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)
                        + "  " + message + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
                // logging must never take the agent down
            }
        }
    }

    /// <summary>
    /// Application event log entries from the agent (source "PresenceLock", registered by
    /// Install-PresenceLock.ps1; a standard user may write to it but not create it). Stable IDs for
    /// SIEM rules. Content is aggregate quality figures only — nothing about what the user does.
    ///   1010 quality below target (false dims above the gate target in enforcing mode)
    ///   1011 quality back within target
    ///   1012 a learned model change made predictions significantly worse and was rolled back
    /// </summary>
    internal static class AgentEvents
    {
        public const int QualityBelowTarget = 1010, QualityRestored = 1011, ModelRolledBack = 1012;

        public static void Write(int id, System.Diagnostics.EventLogEntryType type, string message)
        {
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
