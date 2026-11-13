using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    /// <summary>GPO "User pause". Not part of the learned profile.</summary>
    public sealed class PausePolicy
    {
        public bool Enabled = true;
        /// <summary>The menu choices (minutes), at most three.</summary>
        public int[] OptionsMinutes = { 30, 60, 90 };
        /// <summary>Total pause time per rolling 24 h, however it is split up or re-started.</summary>
        public int BudgetMinutesPer24h = 120;
        /// <summary>
        /// true (default): during a pause the absolute HoldMax confirmation still applies, so an
        /// unattended computer is locked within HoldMax + grace exactly as during a video: the NIS2
        /// bound is unchanged. false: a full pause; only Windows' own lock settings apply.
        /// </summary>
        public bool KeepConfirmation = true;

        public static readonly TimeSpan Window = TimeSpan.FromHours(24);

        public int[] ValidOptions() => (OptionsMinutes ?? new int[0])
            .Where(m => m >= 1 && m <= 1440).Distinct().OrderBy(m => m).Take(3).ToArray();
    }

    /// <summary>
    /// Pause intervals of the last 24 h, kept in the user profile (so a restart or a re-logon does
    /// not reset the budget) and merged with the guard's protected copy in NIS2 mode (so deleting
    /// entries from the file cannot reset it either). Bounded: entries older than 24 h are retired.
    ///
    /// A chosen pause is charged in full when it starts. Ending it early switches protection back on
    /// but refunds nothing: a refund could not be told apart from an edited file.
    /// </summary>
    [DataContract]
    public sealed class PauseLedger
    {
        [DataContract]
        public sealed class Interval
        {
            [DataMember(Name = "s")] public long StartUtcTicks;
            [DataMember(Name = "e")] public long ChargedEndUtcTicks;   // start + chosen length: what the budget pays
            [DataMember(Name = "a")] public long EndedEarlyUtcTicks;   // 0 = runs to the charged end
            public long ActiveEnd => EndedEarlyUtcTicks > 0 ? Math.Min(EndedEarlyUtcTicks, ChargedEndUtcTicks) : ChargedEndUtcTicks;
        }

        [DataMember] public List<Interval> Intervals = new List<Interval>();
        [DataMember] public int PausesStarted;
        [DataMember] public double MinutesChargedTotal;

        public const int MaxIntervals = 1440;   // hard cap even for a 1-minute option used all day
        /// <summary>The longest pause any policy can grant (GPO allows 5-480 min per option).</summary>
        public const int MaxIntervalMinutes = 480;

        /// <summary>
        /// A pause entry is only honoured if it could have been granted: start before end, and no
        /// longer than the longest possible option. Anything else (an edited file, a forged year-long
        /// pause) is dropped here and never reaches the coordinator or the protected copy.
        /// </summary>
        public static bool Plausible(Interval i) =>
            i != null && i.ChargedEndUtcTicks >= i.StartUtcTicks
            && i.ChargedEndUtcTicks - i.StartUtcTicks <= MaxIntervalMinutes * TimeSpan.TicksPerMinute
            && (i.EndedEarlyUtcTicks == 0 || i.EndedEarlyUtcTicks >= i.StartUtcTicks);

        public void Normalize()
        {
            if (Intervals == null) Intervals = new List<Interval>();
            Intervals.RemoveAll(i => !Plausible(i));
            if (Intervals.Count > MaxIntervals) Intervals.RemoveRange(0, Intervals.Count - MaxIntervals);
        }

        public Interval Active(long now) => Intervals.LastOrDefault(i => Plausible(i) && i.StartUtcTicks <= now && now < i.ActiveEnd);
        public bool IsActive(long now) => Active(now) != null;
        public long ActiveUntil(long now) => Active(now)?.ActiveEnd ?? 0;

        /// <summary>Active AND no longer than the longest length the policy in force allows.</summary>
        public bool IsActive(long now, PausePolicy p)
        {
            var a = Active(now);
            if (a == null || p == null) return false;
            int max = p.ValidOptions().DefaultIfEmpty(0).Max();
            return a.ChargedEndUtcTicks - a.StartUtcTicks <= max * TimeSpan.TicksPerMinute;
        }

        /// <summary>Budget charged within the sliding 24-hour window (minutes).</summary>
        public double ChargedMinutes(long now)
        {
            long from = now - PausePolicy.Window.Ticks;
            double c = 0;
            foreach (var i in Intervals)
            {
                long s = Math.Max(i.StartUtcTicks, from), e = i.ChargedEndUtcTicks;
                if (e > s) c += (e - s) / (double)TimeSpan.TicksPerMinute;
            }
            return c;
        }

        public double RemainingMinutes(long now, PausePolicy p) => Math.Max(0, p.BudgetMinutesPer24h - ChargedMinutes(now));

        /// <summary>Why a pause of <paramref name="minutes"/> cannot start now (null = it can).</summary>
        public string WhyNot(int minutes, long now, PausePolicy p)
        {
            if (p == null || !p.Enabled || p.BudgetMinutesPer24h <= 0) return "pause not allowed by policy";
            if (!p.ValidOptions().Contains(minutes)) return "not one of the allowed pause lengths";
            if (IsActive(now)) return "a pause is already running";
            if (RemainingMinutes(now, p) + 1e-9 < minutes) return "the 24-hour pause budget does not allow " + minutes + " min";
            return null;
        }

        public bool TryStart(int minutes, long now, PausePolicy p, out string reason)
        {
            reason = WhyNot(minutes, now, p);
            if (reason != null) return false;
            Retire(now);
            Intervals.Add(new Interval { StartUtcTicks = now, ChargedEndUtcTicks = now + minutes * TimeSpan.TicksPerMinute });
            PausesStarted++;
            MinutesChargedTotal += minutes;
            return true;
        }

        /// <summary>End the running pause now (protection resumes; nothing is refunded). Returns minutes it ran.</summary>
        public double End(long now)
        {
            var a = Active(now);
            if (a == null) return 0;
            a.EndedEarlyUtcTicks = now;
            return (now - a.StartUtcTicks) / (double)TimeSpan.TicksPerMinute;
        }

        /// <summary>When <paramref name="minutes"/> of budget is available again (UTC ticks; long.MaxValue = never).</summary>
        public long AvailableAt(int minutes, long now, PausePolicy p)
        {
            if (RemainingMinutes(now, p) + 1e-9 >= minutes) return now;
            if (minutes > p.BudgetMinutesPer24h) return long.MaxValue;
            long hi = now + PausePolicy.Window.Ticks + 1;          // by then every current charge has slid out
            long lo = now;
            for (int k = 0; k < 50; k++) { long mid = lo + (hi - lo) / 2; if (RemainingMinutes(mid, p) + 1e-9 >= minutes) hi = mid; else lo = mid; }
            return hi;                                              // remaining is non-decreasing in time: bisection is valid
        }

        /// <summary>Cleaning: intervals charged entirely before the 24-hour window no longer count; drop them.</summary>
        public int Retire(long now)
        {
            long from = now - PausePolicy.Window.Ticks;
            return Intervals.RemoveAll(i => i.ChargedEndUtcTicks <= from);
        }

        /// <summary>
        /// NIS2: union with another copy of the ledger (the guard's protected copy). A union can only
        /// ADD charged time, so deleting or shortening entries in the user-writable file never
        /// restores budget. An early end is kept only if it does not lengthen the charge.
        /// </summary>
        public void MergeFrom(PauseLedger other)
        {
            if (other?.Intervals == null) return;
            foreach (var o in other.Intervals)
            {
                var same = Intervals.FirstOrDefault(i => i.StartUtcTicks == o.StartUtcTicks);
                if (same == null)
                    Intervals.Add(new Interval { StartUtcTicks = o.StartUtcTicks, ChargedEndUtcTicks = o.ChargedEndUtcTicks, EndedEarlyUtcTicks = o.EndedEarlyUtcTicks });
                else
                {
                    same.ChargedEndUtcTicks = Math.Max(same.ChargedEndUtcTicks, o.ChargedEndUtcTicks);
                    if (o.EndedEarlyUtcTicks > 0)
                        same.EndedEarlyUtcTicks = same.EndedEarlyUtcTicks > 0 ? Math.Min(same.EndedEarlyUtcTicks, o.EndedEarlyUtcTicks) : o.EndedEarlyUtcTicks;
                }
            }
            Intervals.Sort((a, b) => a.StartUtcTicks.CompareTo(b.StartUtcTicks));
            PausesStarted = Math.Max(PausesStarted, other.PausesStarted);
            MinutesChargedTotal = Math.Max(MinutesChargedTotal, other.MinutesChargedTotal);
            Normalize();
        }
    }
}
