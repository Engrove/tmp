using System;
using System.Collections.Generic;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    // =====================================================================================
    // Habit (routine) learning, modelled on the "Elli Companion" idle forecast:
    //   * an episode journal of idle periods stored as duration INTERVALS
    //     (bounded / right-censored / excluded) — censoring is never turned into an event;
    //   * local weekday and clock taken from the UTC offset AT THE EPISODE START (DST-safe);
    //   * kernel weights: recency half-life 14 d over 42 d, same weekday 1, adjacent weekday
    //     0.25, circular clock distance with a triangular radius;
    //   * a weighted empirical survival ENVELOPE (lower/upper probability, no imputation and no
    //     independent-censoring assumption) with a Kish effective-N sufficiency gate, an
    //     eligible-fraction gate and an explicit policy discount;
    //   * prequential self-evaluation: a verdict is frozen before its outcome is known and
    //     scored afterwards.
    // PresenceLock-specific additions:
    //   * an "off-hours" detector (the user is essentially never active at this weekday/hour);
    //   * the habit verdicts may only make a visible confirmation dim come EARLIER, and only
    //     after they have earned it (Wilson lower bound of their precision).
    // The journal lives in its own file next to the profile, is never exported, never sent to
    // the guard's protected store and can be disabled by policy (it is a presence timeline).
    // =====================================================================================

    /// <summary>
    /// Excluded = a data-quality problem (counts against Elli's eligible-fraction gate).
    /// Hold = idle during a video/call/secure desktop: presence unknown BY DEFINITION, so the episode
    /// is left out of the duration evidence but is not a sign of bad data (does not count against
    /// the gate). Applying Elli's gate to holds would block every user who watches videos.
    /// </summary>
    public enum HabitEvidence : byte { Bounded = 0, RightCensored = 1, Excluded = 2, Hold = 3 }

    /// <summary>One idle episode: from the user's last interaction until they next interacted
    /// (input or unlock). Duration known only as an interval [Lower, Upper].</summary>
    [DataContract]
    public sealed class HabitEpisode
    {
        [DataMember(Name = "t")] public long EntryUtcTicks;
        [DataMember(Name = "o")] public int OffsetMinutes;          // local UTC offset at entry
        [DataMember(Name = "l")] public double Lower;
        [DataMember(Name = "u")] public double Upper = -1;           // < 0 = unbounded (right-censored)
        [DataMember(Name = "k")] public HabitEvidence Kind;

        public double UpperOrInfinity => Upper < 0 ? double.PositiveInfinity : Upper;
        public DateTime Local => new DateTime(EntryUtcTicks + OffsetMinutes * TimeSpan.TicksPerMinute);
        /// <summary>Monday = 0 … Sunday = 6.</summary>
        public int Weekday => ((int)Local.DayOfWeek + 6) % 7;
        public double SecondOfDay => Local.TimeOfDay.TotalSeconds;
    }

    /// <summary>A frozen verdict ("the user will not return within the horizon") and its outcome.</summary>
    [DataContract]
    public sealed class HabitScore
    {
        [DataMember(Name = "p")] public double Predicted;
        [DataMember(Name = "y")] public bool Outcome;
        [DataMember(Name = "s")] public byte Source;                // 1 = routine forecast, 2 = off-hours
    }

    [DataContract]
    public sealed class HabitJournal
    {
        public const int CurrentSchemaVersion = 1;
        [DataMember] public int SchemaVersion = CurrentSchemaVersion;
        [DataMember] public string UserSid = "";
        [DataMember] public List<HabitEpisode> Episodes = new List<HabitEpisode>();
        [DataMember] public List<HabitScore> Scores = new List<HabitScore>();

        /// <summary>In-memory change counter (cache key); not persisted.</summary>
        public int Revision;

        public void Normalize()
        {
            if (Episodes == null) Episodes = new List<HabitEpisode>();
            if (Scores == null) Scores = new List<HabitScore>();
        }
    }

    public sealed class HabitPolicy
    {
        // --- Elli defaults (with one documented deviation) -------------------------------
        /// <summary>
        /// Elli uses 20. A once-a-day event (going home) occurs ~6 times per weekday in 42 days;
        /// with a 14-day half-life Elli's kernel gives it an effective N of ~4.5, so N >= 20 can
        /// never be met. PresenceLock pools workdays (see DayWeight) and uses 10, because its
        /// action is only a visible confirmation dim AND a second gate (measured precision) applies.
        /// </summary>
        public double MinimumEffectiveN = 10;
        public double MinimumEligibleFraction = 0.8;
        public double MinimumProbability = 0.8;
        public double PolicyDiscount = 0.1;          // explicit conservatism, not a confidence bound
        public double HistoryDays = 42;
        public double RecencyHalfLifeDays = 14;
        public double ClockRadiusSeconds = 7200;
        // --- PresenceLock ----------------------------------------------------------------
        /// <summary>Episodes shorter than this are not stored; queries below this age are refused
        /// (the at-risk set would be biased by the missing short episodes).</summary>
        public double MinRecordSeconds = 60;
        public int MaxEpisodes = 5000;
        /// <summary>The claim a verdict makes: "no return within this many seconds".</summary>
        public double HorizonSeconds = 600;
        public double OffHoursRelativeRate = 0.02;   // <= 2 % of the user's peak activity rate
        public double OffHoursClockRadiusSeconds = 3600;
        public double MinHistoryDays = 14;
        public int MinEligibleEpisodes = 100;
        public int MaxScores = 256;
        public int MinScoredVerdicts = 20;
        public double MinPrecisionLower95 = 0.7;
    }

    public struct HabitInterval { public double Lower, Upper, Weight; }

    public struct HabitQuery
    {
        public double Lower, Upper, EffectiveN;
        public int DefiniteAtRisk;
    }

    /// <summary>
    /// Weighted empirical survival envelope (port of Elli's IdleSurvivalEnvelope). For age a and
    /// horizon h it bounds P(duration &gt;= a + h | duration &gt;= a) for every assignment of the
    /// interval-censored durations within their [Lower, Upper]:
    ///   lower = W(Lower &gt;= a+h) / W(Upper &gt;= a)      upper = W(Upper &gt;= a+h) / W(Lower &gt;= a)
    /// These are NOT population confidence bounds. Queries are O(log n).
    /// </summary>
    public sealed class HabitEnvelope
    {
        private sealed class Tail
        {
            private readonly double[] _ends, _weights, _squares;

            public Tail(List<KeyValuePair<double, double>> values)
            {
                values.Sort((x, y) => x.Key.CompareTo(y.Key));
                _ends = new double[values.Count];
                _weights = new double[values.Count + 1];
                _squares = new double[values.Count + 1];
                for (int i = values.Count - 1; i >= 0; i--)
                {
                    _ends[i] = values[i].Key;
                    _weights[i] = _weights[i + 1] + values[i].Value;
                    _squares[i] = _squares[i + 1] + values[i].Value * values[i].Value;
                }
            }

            /// <summary>Total weight, squared weight and count of rows whose end &gt;= value.</summary>
            public void At(double value, out double weight, out double squares, out int count)
            {
                int low = 0, high = _ends.Length;
                while (low < high)
                {
                    int mid = low + (high - low) / 2;
                    if (_ends[mid] < value) low = mid + 1; else high = mid;
                }
                weight = _weights[low]; squares = _squares[low]; count = _ends.Length - low;
            }
        }

        private readonly Tail _lower, _upper;
        public int Rows { get; }

        public HabitEnvelope(IList<HabitInterval> rows)
        {
            var lo = new List<KeyValuePair<double, double>>(rows.Count);
            var up = new List<KeyValuePair<double, double>>(rows.Count);
            foreach (var r in rows)
            {
                if (double.IsNaN(r.Lower) || double.IsInfinity(r.Lower) || r.Lower < 0 || double.IsNaN(r.Upper)
                    || r.Upper < r.Lower || double.IsNaN(r.Weight) || r.Weight <= 0 || r.Weight > 1)
                    throw new ArgumentOutOfRangeException(nameof(rows));
                lo.Add(new KeyValuePair<double, double>(r.Lower, r.Weight));
                up.Add(new KeyValuePair<double, double>(r.Upper, r.Weight));
            }
            _lower = new Tail(lo);
            _upper = new Tail(up);
            Rows = rows.Count;
        }

        public HabitQuery Query(double age, double horizon)
        {
            if (double.IsNaN(age) || age < 0 || double.IsNaN(horizon) || horizon <= 0)
                throw new ArgumentOutOfRangeException(nameof(age));
            _lower.At(age, out double definite, out double definiteSq, out int definiteN);
            _upper.At(age, out double possible, out _, out _);
            _lower.At(age + horizon, out double success, out _, out _);
            _upper.At(age + horizon, out double possibleSuccess, out _, out _);
            double lower = possible > 0 ? MathUtil.Clamp(success / possible, 0, 1) : 0;
            double upper = definite > 0 ? MathUtil.Clamp(possibleSuccess / definite, 0, 1) : 1;
            return new HabitQuery
            {
                Lower = lower,
                Upper = Math.Max(lower, upper),
                EffectiveN = definiteSq > 0 ? Math.Min(definiteN, definite * definite / definiteSq) : 0,
                DefiniteAtRisk = definiteN
            };
        }
    }

    public sealed class HabitCohort
    {
        public HabitEnvelope Envelope;
        public int Recent, Eligible, Weighted;
        public double EligibleFraction;
    }

    public struct HabitVerdict
    {
        public bool Sufficient, LikelyGone;
        public double Lower, Upper, EffectiveN;
    }

    /// <summary>Weekday x hour table of the user's activity rate relative to their own peak.</summary>
    public sealed class HabitActivityTable
    {
        public bool Sufficient;
        public double SpanDays;
        public int EligibleEpisodes;
        public readonly double[] Relative = new double[7 * 24];
    }

    public static class HabitModel
    {
        private const double Z95 = 1.959964;

        public static double ClockWeight(double a, double b, double radius)
        {
            double d = Math.Abs(a - b);
            d = Math.Min(d, 86400 - d);
            return Math.Max(0, 1 - d / radius);
        }

        /// <summary>
        /// Weekday similarity (Monday = 0). Same weekday 1; another day of the same TYPE
        /// (workday Mon-Fri, or weekend Sat-Sun) 0.5; workday vs weekend 0. Elli instead weights
        /// calendar-adjacent days 0.25, which treats Sunday as similar to Monday — wrong for office
        /// presence, where Monday-Friday share a routine and weekends do not.
        /// </summary>
        public static double DayWeight(int a, int b)
        {
            if (a == b) return 1.0;
            bool wa = a < 5, wb = b < 5;
            return wa == wb ? 0.5 : 0.0;
        }

        public static double RecencyWeight(double days, HabitPolicy p) => Math.Pow(0.5, days / p.RecencyHalfLifeDays);

        /// <summary>Store a finished episode (only if long enough to matter) and prune by age and count.</summary>
        public static void Record(HabitJournal j, HabitEpisode e, long nowUtcTicks, HabitPolicy p)
        {
            if (e.UpperOrInfinity >= p.MinRecordSeconds) j.Episodes.Add(e);
            long cutoff = nowUtcTicks - (long)(p.HistoryDays * TimeSpan.TicksPerDay);
            j.Episodes.RemoveAll(x => x.EntryUtcTicks < cutoff);
            if (j.Episodes.Count > p.MaxEpisodes) j.Episodes.RemoveRange(0, j.Episodes.Count - p.MaxEpisodes);
            j.Revision++;
        }

        /// <summary>Elli's Fit: weighted intervals of past episodes around the target's entry slot.</summary>
        public static HabitCohort Fit(HabitJournal j, long entryUtcTicks, int offsetMinutes, HabitPolicy p)
        {
            var target = new HabitEpisode { EntryUtcTicks = entryUtcTicks, OffsetMinutes = offsetMinutes };
            int day = target.Weekday;
            double second = target.SecondOfDay;
            var rows = new List<HabitInterval>();
            int recent = 0, eligible = 0;
            foreach (var e in j.Episodes)
            {
                if (e.EntryUtcTicks >= entryUtcTicks) continue;                 // only the past
                double days = (entryUtcTicks - e.EntryUtcTicks) / (double)TimeSpan.TicksPerDay;
                if (days > p.HistoryDays) continue;
                if (e.Kind == HabitEvidence.Hold) continue;                     // presence unknown by definition
                recent++;
                if (e.Kind == HabitEvidence.Excluded) continue;
                eligible++;
                double w = RecencyWeight(days, p) * DayWeight(e.Weekday, day)
                         * ClockWeight(e.SecondOfDay, second, p.ClockRadiusSeconds);
                if (w > 0) rows.Add(new HabitInterval { Lower = e.Lower, Upper = e.UpperOrInfinity, Weight = w });
            }
            return new HabitCohort
            {
                Envelope = new HabitEnvelope(rows),
                Recent = recent,
                Eligible = eligible,
                Weighted = rows.Count,
                EligibleFraction = recent > 0 ? eligible / (double)recent : 0
            };
        }

        /// <summary>
        /// "Routine departure": after idling <paramref name="age"/> seconds, does this user's history
        /// at this weekday/clock say they will not be back within the horizon? Requires sufficient
        /// support and lower bound minus the policy discount above the probability threshold.
        /// </summary>
        public static HabitVerdict Routine(HabitCohort c, double age, HabitPolicy p)
        {
            if (c == null || age < p.MinRecordSeconds) return default(HabitVerdict);
            var q = c.Envelope.Query(age, p.HorizonSeconds);
            bool sufficient = c.EligibleFraction >= p.MinimumEligibleFraction && q.EffectiveN + 1e-9 >= p.MinimumEffectiveN;
            return new HabitVerdict
            {
                Sufficient = sufficient,
                LikelyGone = sufficient && q.Lower - p.PolicyDiscount >= p.MinimumProbability,
                Lower = q.Lower,
                Upper = q.Upper,
                EffectiveN = q.EffectiveN
            };
        }

        /// <summary>
        /// Activity rate per weekday x hour from episode ENTRIES (an entry means the user was active
        /// just before), kernel-weighted like the forecast, relative to the user's own peak.
        /// </summary>
        public static HabitActivityTable BuildActivityTable(HabitJournal j, long nowUtcTicks, HabitPolicy p)
        {
            var t = new HabitActivityTable();
            double oldest = 0;
            var used = new List<HabitEpisode>();
            foreach (var e in j.Episodes)
            {
                double days = (nowUtcTicks - e.EntryUtcTicks) / (double)TimeSpan.TicksPerDay;
                if (days < 0 || days > p.HistoryDays) continue;
                used.Add(e);
                if (days > oldest) oldest = days;
                if (e.Kind != HabitEvidence.Excluded && e.Kind != HabitEvidence.Hold) t.EligibleEpisodes++;
            }
            t.SpanDays = oldest;
            t.Sufficient = oldest >= p.MinHistoryDays && t.EligibleEpisodes >= p.MinEligibleEpisodes;

            var rate = new double[7 * 24];
            double peak = 0;
            for (int d = 0; d < 7; d++)
                for (int h = 0; h < 24; h++)
                {
                    double s = h * 3600 + 1800, sum = 0;
                    foreach (var e in used)
                    {
                        double dw = DayWeight(e.Weekday, d);
                        if (dw == 0) continue;
                        double cw = ClockWeight(e.SecondOfDay, s, p.OffHoursClockRadiusSeconds);
                        if (cw == 0) continue;
                        sum += RecencyWeight((nowUtcTicks - e.EntryUtcTicks) / (double)TimeSpan.TicksPerDay, p) * dw * cw;
                    }
                    rate[d * 24 + h] = sum;
                    if (sum > peak) peak = sum;
                }
            for (int i = 0; i < rate.Length; i++) t.Relative[i] = peak > 0 ? rate[i] / peak : 0;
            if (peak <= 0) t.Sufficient = false;
            return t;
        }

        public static bool IsOffHours(HabitActivityTable t, long utcTicks, int offsetMinutes, HabitPolicy p)
        {
            if (t == null || !t.Sufficient) return false;
            var local = new HabitEpisode { EntryUtcTicks = utcTicks, OffsetMinutes = offsetMinutes };
            int hour = (int)(local.SecondOfDay / 3600) % 24;
            return t.Relative[local.Weekday * 24 + hour] <= p.OffHoursRelativeRate;
        }

        // ------------------------------------------------------------- prequential scoring

        public static void AddScore(HabitJournal j, double predicted, bool outcome, byte source, HabitPolicy p)
        {
            j.Scores.Add(new HabitScore { Predicted = predicted, Outcome = outcome, Source = source });
            if (j.Scores.Count > p.MaxScores) j.Scores.RemoveRange(0, j.Scores.Count - p.MaxScores);
            j.Revision++;
        }

        public static double WilsonLower(int k, int n)
        {
            if (n <= 0) return 0;
            double ph = k / (double)n, z2 = Z95 * Z95;
            double denom = 1 + z2 / n;
            double center = ph + z2 / (2.0 * n);
            double margin = Z95 * Math.Sqrt(ph * (1 - ph) / n + z2 / (4.0 * n * n));
            return Math.Max(0, (center - margin) / denom);
        }

        /// <summary>Habits may act only when their own verdicts have proven precise on this user.</summary>
        public static bool Earned(HabitJournal j, HabitPolicy p, out int n, out double precision, out double lower95)
        {
            n = j?.Scores.Count ?? 0;
            int k = 0;
            if (j != null) foreach (var s in j.Scores) if (s.Outcome) k++;
            precision = n > 0 ? k / (double)n : 0;
            lower95 = WilsonLower(k, n);
            return n >= p.MinScoredVerdicts && lower95 >= p.MinPrecisionLower95;
        }

        public static double? Brier(HabitJournal j)
        {
            if (j == null || j.Scores.Count == 0) return null;
            double sum = 0;
            foreach (var s in j.Scores) { double y = s.Outcome ? 1 : 0; sum += (s.Predicted - y) * (s.Predicted - y); }
            return sum / j.Scores.Count;
        }
    }
}
