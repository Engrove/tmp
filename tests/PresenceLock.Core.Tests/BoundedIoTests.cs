using System;
using System.IO;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// Disk and memory budgets: nothing the agent or guard writes may grow without bound, and
    /// nothing they read may be loaded if it is larger than its budget.
    /// </summary>
    public class BoundedIoTests : IDisposable
    {
        private readonly ITestOutputHelper _out;
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "pl-bounded-" + Guid.NewGuid().ToString("N"));
        public BoundedIoTests(ITestOutputHelper o) { _out = o; Directory.CreateDirectory(_dir); }
        public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

        private static readonly long T0 = new DateTime(2026, 3, 2, 8, 0, 0, DateTimeKind.Utc).Ticks;

        private string Oversized(string name, long bytes)
        {
            string p = Path.Combine(_dir, name);
            using (var fs = new FileStream(p, FileMode.Create)) fs.SetLength(bytes);   // sparse: not written byte by byte
            return p;
        }

        [Fact]
        public void BoundedFile_ReadsWithinTheLimit_RefusesAboveIt()
        {
            string ok = Path.Combine(_dir, "ok.json");
            File.WriteAllText(ok, "{\"a\":1}");
            Assert.Equal("{\"a\":1}", BoundedFile.ReadAllText(ok, 100));
            Assert.Throws<InvalidDataException>(() => BoundedFile.ReadAllText(Oversized("big.json", 101), 100));
        }

        [Fact]
        public void OversizedProfile_IsTreatedAsCorrupt_NotLoaded()
        {
            string p = Oversized("profile.json", BoundedFile.MaxProfileBytes + 1);
            var t = System.Diagnostics.Stopwatch.StartNew();
            var prof = ProfileStore.LoadOrCreate(p, "S-1-5-21-1", "PC");
            Assert.Equal(OperatingMode.Learning, prof.Modes.Mode);             // fresh profile
            Assert.True(t.ElapsedMilliseconds < 1000, $"{t.ElapsedMilliseconds} ms");
        }

        [Fact]
        public void OversizedJournal_IsTreatedAsCorrupt_AndCapsHoldOnLoad()
        {
            var j = HabitStore.LoadOrCreate(Oversized("habits.json", BoundedFile.MaxJournalBytes + 1), "S-1-5-21-1");
            Assert.Empty(j.Episodes);

            var big = new HabitJournal { UserSid = "S-1-5-21-1" };
            for (int i = 0; i < 6000; i++) big.Episodes.Add(new HabitEpisode { EntryUtcTicks = T0 + i * TimeSpan.TicksPerMinute, Lower = 60, Upper = 61 });
            for (int i = 0; i < 400; i++) big.Scores.Add(new HabitScore { Predicted = 0.9, Outcome = true, Source = 1 });
            big.Normalize();
            Assert.Equal(new HabitPolicy().MaxEpisodes, big.Episodes.Count);
            Assert.Equal(new HabitPolicy().MaxScores, big.Scores.Count);
            Assert.Equal(T0 + 5999 * TimeSpan.TicksPerMinute, big.Episodes.Last().EntryUtcTicks);   // newest kept
        }

        /// <summary>Real sizes at the caps must sit well inside the read limits (margin >= 4x).</summary>
        [Fact]
        public void SizeBudget_RealFilesAtTheirCaps_FitWithMargin()
        {
            var rng = new UserSim.Lcg(3);
            var j = new HabitJournal { UserSid = "S-1-5-21-1111111111-2222222222-3333333333-1001" };
            var hp = new HabitPolicy();
            for (int i = 0; i < hp.MaxEpisodes; i++)
                j.Episodes.Add(new HabitEpisode { EntryUtcTicks = T0 + i * 7919 * TimeSpan.TicksPerSecond, OffsetMinutes = 60,
                                                  Lower = rng.UniformInt(60, 99999) + 0.123456789, Upper = rng.UniformInt(1, 2) == 1 ? -1 : 123456.987654321,
                                                  Kind = HabitEvidence.Bounded });
            for (int i = 0; i < hp.MaxScores; i++) HabitModel.AddScore(j, 0.912345678901, true, 1, hp);
            long journal = HabitStore.Serialize(j).Length;

            var sim = new CadRhythmSim(new CoordinatorConfig(), false, -1, 7).Run(63);   // a profile after 63 days
            long profile = ProfileStore.Serialize(sim.Profile).Length;
            _out.WriteLine($"habits.json at caps: {journal / 1024.0:F0} KB (limit {BoundedFile.MaxJournalBytes / 1024} KB); " +
                           $"profile.json after 63 days: {profile / 1024.0:F1} KB (limit {BoundedFile.MaxProfileBytes / 1024} KB)");
            Assert.True(journal * 4 <= BoundedFile.MaxJournalBytes);
            Assert.True(profile * 4 <= BoundedFile.MaxProfileBytes);
        }

        [Fact]
        public void RotatingLog_NeverExceedsTwoFiles_OfItsBudget()
        {
            var log = new RotatingLog(Path.Combine(_dir, "agent.log"), 16 * 1024);
            var now = new DateTime(2026, 3, 2, 8, 0, 0);
            for (int i = 0; i < 20000; i++) log.Write("distinct line " + i + " " + new string('x', i % 300), now, T0 + i);
            long cur = new FileInfo(log.PathName).Length, old = new FileInfo(log.RotatedPathName).Length;
            _out.WriteLine($"current {cur} B, rotated {old} B, budget 2 x {16 * 1024} B");
            Assert.True(cur <= 16 * 1024 && old <= 16 * 1024);
            Assert.Equal(2, Directory.GetFiles(_dir, "agent.log*").Length);
        }

        [Fact]
        public void RotatingLog_CutsLongLines_AndCollapsesRepeats()
        {
            var log = new RotatingLog(Path.Combine(_dir, "agent.log"));
            var now = new DateTime(2026, 3, 2, 8, 0, 0);
            log.Write(new string('e', 100000), now, T0);
            Assert.True(new FileInfo(log.PathName).Length < RotatingLog.MaxLineChars + 100);

            int written = 0;
            for (int i = 0; i < 1000; i++)                                   // one per second for ~17 min
                if (log.Write("ui exception: same thing", now, T0 + i * TimeSpan.TicksPerSecond)) written++;
            Assert.Equal(2, written);                                       // t = 0 and t = 600 s
            Assert.Contains("(repeated 599 more time(s)", File.ReadAllText(log.PathName));
        }

        [Fact]
        public void EventThrottle_PersistentGuardFailure_ForADay_GivesAtMost24Entries()
        {
            // Guard polls every 2 s; a start failure that never goes away = 43 200 attempts a day.
            var th = new EventThrottle();
            int emitted = 0, lastSuppressed = 0;
            for (int i = 0; i < 43200; i++)
                if (th.ShouldEmit("1004|s1", T0 + i * 2 * TimeSpan.TicksPerSecond, TimeSpan.FromHours(1), out int sup)) { emitted++; if (sup > 0) lastSuppressed = sup; }
            _out.WriteLine($"43 200 failures in 24 h -> {emitted} event-log entries (each carries ~{lastSuppressed} suppressed)");
            Assert.Equal(24, emitted);
            Assert.Equal(1799, lastSuppressed);
        }

        [Fact]
        public void EventThrottle_KeysAreIndependent_AndTheTableIsBounded()
        {
            var th = new EventThrottle();
            Assert.True(th.ShouldEmit("1001|s1", T0, TimeSpan.FromMinutes(1), out _));
            Assert.True(th.ShouldEmit("1001|s2", T0, TimeSpan.FromMinutes(1), out _));   // other session
            Assert.False(th.ShouldEmit("1001|s1", T0 + 1, TimeSpan.FromMinutes(1), out _));
            for (int i = 0; i < 1000; i++) th.ShouldEmit("k" + i, T0 + i, TimeSpan.FromHours(1), out _);
            Assert.Equal(EventThrottle.MaxKeys, th.KeyCount);
        }
    }
}
