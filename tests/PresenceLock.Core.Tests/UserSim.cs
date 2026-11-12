using System;
using System.Collections.Generic;
using PresenceLock.Core;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// Line-for-line C# port of verify/user_sim.py. Same 31-bit LCG, same call order of the
    /// random generator, same episode rules — so the REAL C# engine can be compared against
    /// the Python reference's golden output (verify/parity_golden.json).
    /// </summary>
    internal static class UserSim
    {
        public const long Sec = TimeSpan.TicksPerSecond;
        public const long BaseTicks = 638_000_000_000_000_000L;
        public const int LongAbsence = 180;

        public sealed class Lcg
        {
            private long _s;
            public Lcg(long seed) { _s = seed & 0x7FFFFFFF; }
            public long Next() { _s = (_s * 1103515245L + 12345L) & 0x7FFFFFFFL; return _s; }
            public int UniformInt(int lo, int hi) => lo + (int)(Next() % (hi - lo + 1));
        }

        public sealed class PhaseStats
        {
            public int Episodes, PresentEpisodes, DimsOnPresent, LocksOnPresent,
                       Departures, LockedDepartures, MissedDepartures;
            public List<int> Latencies = new List<int>();
        }

        public sealed class Result
        {
            public PresenceEngine Engine;
            public PhaseStats Learning = new PhaseStats();
            public PhaseStats Enforcing = new PhaseStats();
            public int? PromotedDay;
        }

        public static FeatureVector ReadingSig()
        {
            var f = new FeatureVector();
            f.X[FeatureSchema.CtxReading] = 1.0;
            f.X[FeatureSchema.ScrollFrac] = 0.6;
            f.X[FeatureSchema.Deceleration] = 0.8;
            return f;
        }

        public static FeatureVector LeavingSig()
        {
            var f = new FeatureVector();
            f.X[FeatureSchema.AbruptStop] = 1.0;
            f.X[FeatureSchema.EdgeFling] = 1.0;
            f.X[FeatureSchema.CtxLeaving] = 1.0;
            f.X[FeatureSchema.MicroJerk] = 1.0;
            return f;
        }

        private static long Episode(PresenceEngine eng, long now, FeatureVector sig,
                                    int presentFor, int? awayFor, Result res)
        {
            bool departing = awayFor.HasValue;
            var st = eng.Mode == OperatingMode.Enforcing ? res.Enforcing : res.Learning;
            st.Episodes++;
            if (departing) st.Departures++; else st.PresentEpisodes++;

            eng.BeginEpisode(sig, now);
            int idle = 0;
            while (true)
            {
                idle++;
                now += Sec;
                eng.UpdateLive(idle);
                var r = eng.Tick(now);
                var modeNow = eng.Mode;
                bool present = idle <= presentFor;

                if (modeNow == OperatingMode.Enforcing)
                {
                    if (r.Action == DecisionAction.SoftDim && present)
                    {
                        st.DimsOnPresent++;
                        now += Sec;
                        eng.OnInputResumed(now);
                        return now;
                    }
                    if (r.Action == DecisionAction.TriggerLock)
                    {
                        long unlock;
                        if (present)
                        {
                            st.LocksOnPresent++;
                            unlock = now + 5 * Sec;
                        }
                        else
                        {
                            st.LockedDepartures++;
                            st.Latencies.Add(idle - presentFor);
                            unlock = now + Math.Max(1, presentFor + awayFor.Value - idle) * Sec;
                        }
                        eng.ApplyEnforcedLockOutcome(unlock);
                        return unlock;
                    }
                }

                if (!departing && idle >= presentFor)
                {
                    eng.OnInputResumed(now);
                    return now;
                }
                if (departing && idle >= LongAbsence)
                {
                    if (modeNow == OperatingMode.Enforcing) st.MissedDepartures++;
                    eng.OnLongAbsence(now);
                    return now + Math.Max(0, presentFor + awayFor.Value - idle) * Sec;
                }
            }
        }

        public static Result Run(int days, long seed, bool ambiguous)
        {
            var res = new Result { Engine = new PresenceEngine(new UserProfile()) };
            var eng = res.Engine;
            var rng = new Lcg(seed);

            for (int day = 0; day < days; day++)
            {
                long now = BaseTicks + day * TimeSpan.TicksPerDay + 8L * 3600 * Sec;
                var kinds = new List<string>();
                for (int k = 0; k < 10; k++) kinds.Add("read");
                for (int k = 0; k < 2; k++) kinds.Add("read_then_leave");
                for (int k = 0; k < 3; k++) kinds.Add("leave");
                for (int k = 0; k < 2; k++) kinds.Add("manual");
                if (ambiguous) kinds.Add("leave_like_present");
                for (int i = kinds.Count - 1; i > 0; i--)
                {
                    int j = (int)(rng.Next() % (i + 1));
                    var tmp = kinds[i]; kinds[i] = kinds[j]; kinds[j] = tmp;
                }

                foreach (var kind in kinds)
                {
                    switch (kind)
                    {
                        case "manual":
                            (eng.Mode == OperatingMode.Enforcing ? res.Enforcing : res.Learning).Episodes++;
                            now += 2 * Sec;
                            var sig = LeavingSig();
                            sig.IdleSeconds = 1.0;
                            eng.OnManualLock(sig, now);
                            now += rng.UniformInt(300, 900) * Sec;
                            break;
                        case "read":
                            now = Episode(eng, now, ReadingSig(), rng.UniformInt(15, 100), null, res);
                            break;
                        case "read_then_leave":
                            int d = rng.UniformInt(10, 60);
                            int away = rng.UniformInt(300, 900);
                            now = Episode(eng, now, ReadingSig(), d, away, res);
                            break;
                        case "leave_like_present":
                            now = Episode(eng, now, LeavingSig(), rng.UniformInt(5, 30), null, res);
                            break;
                        default: // leave
                            now = Episode(eng, now, LeavingSig(), 0, rng.UniformInt(300, 900), res);
                            break;
                    }
                    now += rng.UniformInt(30, 600) * Sec;
                }

                eng.Tick(now);
                if (res.PromotedDay == null && eng.Mode == OperatingMode.Enforcing)
                    res.PromotedDay = day;
            }
            return res;
        }
    }
}
