using System;
using System.Collections.Generic;
using System.Linq;
using PresenceLock.Core;
using Xunit;

namespace PresenceLock.Core.Tests
{
    public class HabitModelTests
    {
        private static readonly HabitPolicy P = new HabitPolicy();
        private static long Utc(int y, int mo, int d, int h, int mi) => new DateTime(y, mo, d, h, mi, 0, DateTimeKind.Utc).Ticks;
        private static readonly DateTime Monday = new DateTime(2026, 3, 2);   // a Monday

        // ---------------------------------------------------------------- envelope

        [Fact]
        public void Envelope_MatchesBruteForce_ForRandomIntervals()
        {
            var rnd = new Random(11);
            for (int trial = 0; trial < 200; trial++)
            {
                var rows = new List<HabitInterval>();
                int n = 1 + rnd.Next(60);
                for (int i = 0; i < n; i++)
                {
                    double lo = rnd.NextDouble() * 3000;
                    double up = rnd.Next(4) == 0 ? double.PositiveInfinity : lo + rnd.NextDouble() * 600;
                    rows.Add(new HabitInterval { Lower = lo, Upper = up, Weight = 0.05 + 0.95 * rnd.NextDouble() });
                }
                var env = new HabitEnvelope(rows);
                double age = rnd.NextDouble() * 2000, h = 1 + rnd.NextDouble() * 900;
                var q = env.Query(age, h);

                double W(Func<HabitInterval, bool> f) => rows.Where(f).Sum(r => r.Weight);
                double possible = W(r => r.Upper >= age), definite = W(r => r.Lower >= age);
                double lower = possible > 0 ? W(r => r.Lower >= age + h) / possible : 0;
                double upper = definite > 0 ? W(r => r.Upper >= age + h) / definite : 1;
                Assert.Equal(Math.Min(1, lower), q.Lower, 12);
                Assert.Equal(Math.Max(Math.Min(1, lower), Math.Min(1, upper)), q.Upper, 12);
                Assert.True(q.Lower <= q.Upper + 1e-12);
            }
        }

        [Fact]
        public void Envelope_ExactDurations_GiveThePointSurvival()
        {
            // 10 exact durations 100..1000 s: P(D >= 700 | D >= 300) = 4/8
            var rows = Enumerable.Range(1, 10).Select(i => new HabitInterval { Lower = i * 100, Upper = i * 100, Weight = 1 }).ToList();
            var q = new HabitEnvelope(rows).Query(300, 400);
            Assert.Equal(0.5, q.Lower, 12);
            Assert.Equal(0.5, q.Upper, 12);
            Assert.Equal(8, q.DefiniteAtRisk);
            Assert.Equal(8, q.EffectiveN, 9);
        }

        [Fact]
        public void Envelope_CensoringWidensTheBounds_NeverPretendsToKnow()
        {
            var rows = new List<HabitInterval>
            {
                new HabitInterval { Lower = 500, Upper = double.PositiveInfinity, Weight = 1 },  // censored at 500
                new HabitInterval { Lower = 2000, Upper = 2000, Weight = 1 }
            };
            var q = new HabitEnvelope(rows).Query(300, 600);   // target 900 s
            Assert.Equal(0.5, q.Lower, 12);                    // censored row might have ended at 500
            Assert.Equal(1.0, q.Upper, 12);                    // ... or lasted forever
        }

        // ---------------------------------------------------------------- kernels & time

        [Fact]
        public void Kernels_WorkdaysPool_WeekendsSeparate_ClockIsCircular()
        {
            Assert.Equal(1.0, HabitModel.DayWeight(2, 2));
            Assert.Equal(0.5, HabitModel.DayWeight(0, 4));     // Mon ~ Fri
            Assert.Equal(0.5, HabitModel.DayWeight(5, 6));     // Sat ~ Sun
            Assert.Equal(0.0, HabitModel.DayWeight(6, 0));     // Sun !~ Mon
            Assert.Equal(0.5, HabitModel.ClockWeight(23.5 * 3600, 0.5 * 3600, 7200), 12);  // 1 h apart across midnight
            Assert.Equal(0.0, HabitModel.ClockWeight(10 * 3600, 13 * 3600, 7200));
        }

        [Fact]
        public void LocalTime_UsesTheOffsetAtEntry_DstSafe()
        {
            long utc = Utc(2026, 3, 30, 15, 0);                 // Monday 15:00 UTC
            var summer = new HabitEpisode { EntryUtcTicks = utc, OffsetMinutes = 120 };
            var winter = new HabitEpisode { EntryUtcTicks = utc, OffsetMinutes = 60 };
            Assert.Equal(17 * 3600, summer.SecondOfDay, 6);
            Assert.Equal(16 * 3600, winter.SecondOfDay, 6);
            Assert.Equal(0, summer.Weekday);                    // Monday = 0
        }

        // ---------------------------------------------------------------- journal

        [Fact]
        public void Record_DropsShortEpisodes_PrunesOld_CapsSize()
        {
            var j = new HabitJournal();
            long now = Utc(2026, 3, 30, 12, 0);
            HabitModel.Record(j, new HabitEpisode { EntryUtcTicks = now, Lower = 10, Upper = 20 }, now, P);
            Assert.Empty(j.Episodes);                                          // < 60 s
            HabitModel.Record(j, new HabitEpisode { EntryUtcTicks = now - 50 * TimeSpan.TicksPerDay, Lower = 100, Upper = 200 }, now, P);
            Assert.Empty(j.Episodes);                                          // > 42 days
            var small = new HabitPolicy { MaxEpisodes = 3 };
            for (int i = 0; i < 5; i++)
                HabitModel.Record(j, new HabitEpisode { EntryUtcTicks = now + i, Lower = 100, Upper = -1, Kind = HabitEvidence.RightCensored }, now, small);
            Assert.Equal(3, j.Episodes.Count);
            Assert.Equal(now + 2, j.Episodes[0].EntryUtcTicks);                // oldest dropped
        }

        [Fact]
        public void Journal_RoundTrip_KeepsUnboundedMarker()
        {
            var j = new HabitJournal { UserSid = "S-1-5-21-1-2-3-1001" };
            j.Episodes.Add(new HabitEpisode { EntryUtcTicks = 42, OffsetMinutes = 60, Lower = 90, Upper = -1, Kind = HabitEvidence.RightCensored });
            j.Scores.Add(new HabitScore { Predicted = 0.9, Outcome = true, Source = 2 });
            var k = HabitStore.Deserialize(HabitStore.Serialize(j));
            Assert.Equal(double.PositiveInfinity, k.Episodes[0].UpperOrInfinity);
            Assert.Equal(HabitEvidence.RightCensored, k.Episodes[0].Kind);
            Assert.Equal(60, k.Episodes[0].OffsetMinutes);
            Assert.True(k.Scores[0].Outcome);
            Assert.Equal(j.UserSid, k.UserSid);
        }

        // ---------------------------------------------------------------- forecasts

        /// <summary>6 weeks of a regular office day: short breaks in the morning, home at ~17:00.</summary>
        private static HabitJournal OfficeRoutine(DateTime targetDay, int weeks = 6)
        {
            var j = new HabitJournal();
            for (int back = 1; back <= weeks * 7; back++)
            {
                var day = targetDay.AddDays(-back);
                if (day.DayOfWeek == DayOfWeek.Saturday || day.DayOfWeek == DayOfWeek.Sunday) continue;
                foreach (int h in new[] { 9, 10, 11 })
                    j.Episodes.Add(new HabitEpisode
                    {
                        EntryUtcTicks = new DateTime(day.Year, day.Month, day.Day, h, 15, 0, DateTimeKind.Utc).Ticks,
                        Lower = 240, Upper = 241, Kind = HabitEvidence.Bounded            // 4-min coffee breaks
                    });
                j.Episodes.Add(new HabitEpisode
                {
                    EntryUtcTicks = new DateTime(day.Year, day.Month, day.Day, 17, back % 3 * 10, 0, DateTimeKind.Utc).Ticks,
                    Lower = 15 * 3600, Upper = 15 * 3600 + 15, Kind = HabitEvidence.Bounded   // home overnight
                });
            }
            return j;
        }

        [Fact]
        public void Routine_RecognisesGoingHome_ButNotACoffeeBreak()
        {
            var j = OfficeRoutine(Monday);
            long home = new DateTime(2026, 3, 2, 17, 5, 0, DateTimeKind.Utc).Ticks;
            var v = HabitModel.Routine(HabitModel.Fit(j, home, 0, P), 120, P);
            Assert.True(v.Sufficient, $"effN {v.EffectiveN:F1}");
            Assert.True(v.LikelyGone, $"lower {v.Lower:F2}");

            long coffee = new DateTime(2026, 3, 2, 10, 15, 0, DateTimeKind.Utc).Ticks;
            var c = HabitModel.Routine(HabitModel.Fit(j, coffee, 0, P), 120, P);
            Assert.True(c.Sufficient);
            Assert.False(c.LikelyGone, $"lower {c.Lower:F2}");
        }

        [Fact]
        public void Routine_RefusesToSpeak_WithTooLittleHistory_OrTooEarlyAge()
        {
            var j = OfficeRoutine(Monday, weeks: 1);
            long home = new DateTime(2026, 3, 2, 17, 5, 0, DateTimeKind.Utc).Ticks;
            Assert.False(HabitModel.Routine(HabitModel.Fit(j, home, 0, P), 120, P).Sufficient);
            var full = OfficeRoutine(Monday);
            Assert.False(HabitModel.Routine(HabitModel.Fit(full, home, 0, P), 30, P).LikelyGone);   // age < 60 s
        }

        [Fact]
        public void Routine_TooManyExcludedEpisodes_IsInsufficient()
        {
            var j = OfficeRoutine(Monday);
            foreach (var e in j.Episodes.Where((e, i) => i % 3 == 0)) e.Kind = HabitEvidence.Excluded;  // 1/3 excluded
            long home = new DateTime(2026, 3, 2, 17, 5, 0, DateTimeKind.Utc).Ticks;
            var c = HabitModel.Fit(j, home, 0, P);
            Assert.True(c.EligibleFraction < P.MinimumEligibleFraction);
            Assert.False(HabitModel.Routine(c, 120, P).Sufficient);
        }

        [Fact]
        public void HoldEpisodes_AreNotEvidence_AndDoNotTripTheQualityGate()
        {
            var j = OfficeRoutine(Monday);
            foreach (var e in j.Episodes.Where((e, i) => i % 3 == 0)) e.Kind = HabitEvidence.Hold;   // videos/calls
            long home = new DateTime(2026, 3, 2, 17, 5, 0, DateTimeKind.Utc).Ticks;
            var c = HabitModel.Fit(j, home, 0, P);
            Assert.Equal(1.0, c.EligibleFraction, 12);
            Assert.True(HabitModel.Routine(c, 120, P).Sufficient);
        }

        [Fact]
        public void OffHours_NightIsOff_WorkingHoursAreNot_AndNeedsHistory()
        {
            var j = OfficeRoutine(Monday);
            long now = new DateTime(2026, 3, 2, 12, 0, 0, DateTimeKind.Utc).Ticks;
            var t = HabitModel.BuildActivityTable(j, now, P);
            Assert.True(t.Sufficient);
            Assert.True(HabitModel.IsOffHours(t, new DateTime(2026, 3, 2, 22, 30, 0, DateTimeKind.Utc).Ticks, 0, P));
            Assert.True(HabitModel.IsOffHours(t, new DateTime(2026, 3, 7, 11, 0, 0, DateTimeKind.Utc).Ticks, 0, P));   // Saturday
            Assert.False(HabitModel.IsOffHours(t, new DateTime(2026, 3, 2, 10, 30, 0, DateTimeKind.Utc).Ticks, 0, P));
            var thin = HabitModel.BuildActivityTable(OfficeRoutine(Monday, weeks: 1), now, P);
            Assert.False(thin.Sufficient);
            Assert.False(HabitModel.IsOffHours(thin, new DateTime(2026, 3, 2, 22, 30, 0, DateTimeKind.Utc).Ticks, 0, P));
        }

        // ---------------------------------------------------------------- self-evaluation gate

        [Fact]
        public void WilsonLower_KnownValues()
        {
            Assert.InRange(HabitModel.WilsonLower(20, 20), 0.83, 0.84);   // 0.8389
            Assert.InRange(HabitModel.WilsonLower(0, 10), 0.0, 1e-12);
            Assert.InRange(HabitModel.WilsonLower(45, 50), 0.78, 0.79);   // 0.7864
        }

        [Fact]
        public void Earned_RequiresEnoughPreciseVerdicts()
        {
            var j = new HabitJournal();
            for (int i = 0; i < 19; i++) HabitModel.AddScore(j, 0.9, true, 1, P);
            Assert.False(HabitModel.Earned(j, P, out _, out _, out _));                 // n < 20
            HabitModel.AddScore(j, 0.9, true, 1, P);
            Assert.True(HabitModel.Earned(j, P, out int n, out _, out double lo));
            Assert.Equal(20, n);
            for (int i = 0; i < 15; i++) HabitModel.AddScore(j, 0.9, false, 1, P);      // 20/35 = 57 %
            Assert.False(HabitModel.Earned(j, P, out _, out _, out lo));
            Assert.True(lo < P.MinPrecisionLower95);
        }
    }
}
