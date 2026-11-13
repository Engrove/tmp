using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace PresenceLock.Core
{
    /// <summary>
    /// Retention periods (GPO "Data retention"). Everything the agent and the guard keep is either
    /// fixed-size or retired by age; the read limits in <see cref="BoundedFile"/> are a last-resort
    /// safety valve that a correctly running agent never reaches.
    /// </summary>
    public sealed class RetentionPolicy
    {
        public int LogRetentionDays = 30;                // agent.log / agent.log.1 content
        public int ProtectedCopyRetentionDays = 180;     // guard copy of a user who has not logged on since
        public int CollectedProfileRetentionDays = 90;   // files in ProfileExportDirectory, and --merge-baseline inputs
        public double TempFileMaxAgeHours = 1;           // *.tmp left behind by a crash mid-save
        public static readonly TimeSpan Interval = TimeSpan.FromHours(24);
    }

    public sealed class HousekeepingReport
    {
        public int JournalEpisodesRetired, JournalScoresRetired;
        public readonly List<string> FilesDeleted = new List<string>();
        public bool BackupWritten;
        public string BackupSkippedReason;
        public bool AnythingRetired => JournalEpisodesRetired + JournalScoresRetired + FilesDeleted.Count > 0;
        public override string ToString() =>
            "housekeeping: journal episodes retired " + JournalEpisodesRetired + ", scores retired " + JournalScoresRetired +
            ", files deleted " + FilesDeleted.Count + (FilesDeleted.Count > 0 ? " (" + string.Join(", ", FilesDeleted.Select(Path.GetFileName)) + ")" : "") +
            ", backup " + (BackupWritten ? "written" : "skipped: " + (BackupSkippedReason ?? "-"));
    }

    /// <summary>
    /// The cleaning service. Runs at agent start and every 24 h (agent: its own folder and journal;
    /// guard: protected copies and this computer's collected profiles). Each step is independent and
    /// idempotent; a failing step never stops the others or the agent.
    /// </summary>
    public static class Housekeeping
    {
        public const string BackupSuffix = ".bak";

        /// <summary>Retire journal data by age and count, independent of whether anything new is recorded
        /// (a user back from three months' leave must not carry a stale journal).</summary>
        public static void PruneJournal(HabitJournal j, long nowUtcTicks, HabitPolicy p, HousekeepingReport report)
        {
            if (j == null) return;
            j.Normalize();
            int before = j.Episodes.Count, scoresBefore = j.Scores.Count;
            long cutoff = nowUtcTicks - (long)(p.HistoryDays * TimeSpan.TicksPerDay);
            j.Episodes.RemoveAll(e => e.EntryUtcTicks < cutoff || e.EntryUtcTicks > nowUtcTicks + TimeSpan.TicksPerDay);
            if (j.Episodes.Count > p.MaxEpisodes) j.Episodes.RemoveRange(0, j.Episodes.Count - p.MaxEpisodes);
            if (j.Scores.Count > p.MaxScores) j.Scores.RemoveRange(0, j.Scores.Count - p.MaxScores);
            if (j.Episodes.Count != before || j.Scores.Count != scoresBefore) j.Revision++;
            report.JournalEpisodesRetired += before - j.Episodes.Count;
            report.JournalScoresRetired += scoresBefore - j.Scores.Count;
        }

        public static int RetirePauses(UserProfile p, long nowUtcTicks) => p?.Pause?.Retire(nowUtcTicks) ?? 0;

        /// <summary>
        /// The agent's own folder: crash leftovers (*.tmp). Never touches profile.json, habits.json
        /// or the backup. (Log lines are retired line by line by <see cref="RotatingLog.Retire"/>.)
        /// </summary>
        public static void CleanAgentDirectory(string dir, DateTime utcNow, RetentionPolicy r, HousekeepingReport report)
        {
            if (!Directory.Exists(dir)) return;
            foreach (var f in Directory.GetFiles(dir, "*.tmp"))
                TryDelete(f, utcNow - File.GetLastWriteTimeUtc(f) > TimeSpan.FromHours(r.TempFileMaxAgeHours), report);
        }

        /// <summary>
        /// Keep ONE last-known-good copy of the profile (fixed name, overwritten): written only after
        /// the current file has been read back and parsed, so a corrupt file never replaces a good backup.
        /// </summary>
        public static void WriteBackup(string profilePath, HousekeepingReport report)
        {
            try
            {
                var p = ProfileStore.Deserialize(BoundedFile.ReadAllText(profilePath, BoundedFile.MaxProfileBytes));
                if (p == null || p.SchemaVersion != UserProfile.CurrentSchemaVersion) { report.BackupSkippedReason = "profile not current"; return; }
                string tmp = ProfileStore.TempName(profilePath + BackupSuffix), bak = profilePath + BackupSuffix;
                File.Copy(profilePath, tmp, true);
                if (File.Exists(bak)) File.Replace(tmp, bak, null); else File.Move(tmp, bak);
                report.BackupWritten = true;
            }
            catch (Exception ex) { report.BackupSkippedReason = ex.GetType().Name; }
        }

        /// <summary>Files matching <paramref name="pattern"/> not written for longer than <paramref name="days"/>.</summary>
        public static IEnumerable<string> Expired(string dir, string pattern, DateTime utcNow, int days)
        {
            if (!Directory.Exists(dir)) yield break;
            foreach (var f in Directory.GetFiles(dir, pattern))
                if (utcNow - File.GetLastWriteTimeUtc(f) > TimeSpan.FromDays(days)) yield return f;
        }

        public static void TryDelete(string file, bool condition, HousekeepingReport report)
        {
            if (!condition) return;
            try { File.Delete(file); report.FilesDeleted.Add(file); }
            catch (Exception) { /* locked or no rights: try again next run */ }
        }
    }
}
