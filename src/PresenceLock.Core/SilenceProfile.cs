using System;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    /// <summary>
    /// Per-user, per-activity "silence profile": how long THIS user's silences last in each kind of
    /// application, learned from silences that ended with the user touching the computer again
    /// (no dim, no lock, no media/meeting hold in between).
    ///
    /// Why: such a silence is AMBIGUOUS. Studying a drawing for 6 minutes and fetching coffee for
    /// 6 minutes look the same to every permission-free sensor. Labels must stay factual, so these
    /// episodes never train the model. But the learning-period safety gate must still judge the
    /// invisible decisions made during them, and counting every one as a false dim blocks users who
    /// often leave from a reading application.
    ///
    /// Model: ln(duration) in each activity class is fitted as a mixture of two populations — short
    /// silences (working at the desk) and long ones (away). The fit is only USED when the data shows
    /// two clearly separated populations (Ashman's D &gt;= 2, the long one a minority, enough data).
    /// Otherwise — e.g. a CAD user whose studying times run continuously into coffee-break times —
    /// it reports "cannot tell" and the gate stays conservative.
    ///
    /// Storage: decayed bin counters only (14-day half-life). No timestamps, no per-episode records.
    /// </summary>
    [DataContract]
    public sealed class SilenceProfile
    {
        public const int Contexts = 3;                 // 0 neutral, 1 silent-work (reading list), 2 leaving
        public const int Bins = 48;
        public const double MinSeconds = 30.0;         // shorter pauses are typing rhythm, not "silences"
        public const double BinWidth = 0.1;            // in ln(seconds): ~10.5 % per bin, 30 s .. ~3645 s
        public static readonly double LnMin = Math.Log(MinSeconds);
        public static readonly string[] ContextNames = { "neutral", "silent-work", "leaving" };

        [DataMember] public double[] Counts = new double[Contexts * Bins];
        [DataMember] public long LastUpdateUtcTicks;
        [DataMember] public double HalfLifeDays = 14.0;

        public static int ContextOf(FeatureVector f)
        {
            if (f == null) return 0;
            if (f.X[FeatureSchema.CtxReading] >= 0.5) return 1;
            if (f.X[FeatureSchema.CtxLeaving] >= 0.5) return 2;
            return 0;
        }

        public void Normalize()
        {
            if (Counts == null || Counts.Length != Contexts * Bins) Counts = new double[Contexts * Bins];
            for (int i = 0; i < Counts.Length; i++)
                if (double.IsNaN(Counts[i]) || double.IsInfinity(Counts[i]) || Counts[i] < 0) Counts[i] = 0;
            if (!(HalfLifeDays > 0)) HalfLifeDays = 14.0;
        }

        private double DecayFactor(long nowUtcTicks)
        {
            if (LastUpdateUtcTicks == 0 || nowUtcTicks <= LastUpdateUtcTicks) return 1.0;
            double days = (nowUtcTicks - LastUpdateUtcTicks) / (double)TimeSpan.TicksPerDay;
            return Math.Pow(0.5, days / HalfLifeDays);
        }

        /// <summary>Record one silence that ended with input, without any intervention.</summary>
        public void Record(int context, double seconds, long nowUtcTicks)
        {
            if (context < 0 || context >= Contexts || double.IsNaN(seconds) || seconds < MinSeconds) return;
            double f = DecayFactor(nowUtcTicks);
            if (f < 1.0) for (int i = 0; i < Counts.Length; i++) Counts[i] *= f;
            if (nowUtcTicks > LastUpdateUtcTicks) LastUpdateUtcTicks = nowUtcTicks;
            int bin = (int)Math.Floor((Math.Log(seconds) - LnMin) / BinWidth);
            if (bin < 0) bin = 0;
            if (bin >= Bins) bin = Bins - 1;
            Counts[context * Bins + bin] += 1.0;
        }

        /// <summary>Effective number of recent silences in a context (decayed to <paramref name="nowUtcTicks"/>).</summary>
        public double Count(int context, long nowUtcTicks)
        {
            double n = 0;
            for (int b = 0; b < Bins; b++) n += Counts[context * Bins + b];
            return n * DecayFactor(nowUtcTicks);
        }

        public SilenceMixture Fit(int context, long nowUtcTicks, SilencePolicy policy = null)
        {
            policy = policy ?? new SilencePolicy();
            var w = new double[Bins];
            var x = new double[Bins];
            double n = 0;
            double scale = DecayFactor(nowUtcTicks);
            for (int b = 0; b < Bins; b++)
            {
                w[b] = Counts[context * Bins + b] * scale;
                x[b] = LnMin + (b + 0.5) * BinWidth;
                n += w[b];
            }
            var m = new SilenceMixture { Context = context, N = n };
            if (n < policy.MinSilences) { m.Reason = "too few silences"; return m; }

            // Initialisation from weighted quantiles: short population low, long population high.
            double q30 = Quantile(x, w, n, 0.30), q90 = Quantile(x, w, n, 0.90);
            double mean = 0; for (int b = 0; b < Bins; b++) mean += w[b] * x[b]; mean /= n;
            double var = 0; for (int b = 0; b < Bins; b++) var += w[b] * (x[b] - mean) * (x[b] - mean); var /= n;
            double s0 = Math.Max(Math.Sqrt(var) / 2, SilenceMixture.MinSd);
            double m1 = q30, m2 = Math.Max(q90, q30 + BinWidth), v1 = s0 * s0, v2 = s0 * s0, pi = 0.2;
            var r = new double[Bins];
            for (int it = 0; it < 300; it++)
            {
                double n2 = 0, sx2 = 0, sx1 = 0;
                for (int b = 0; b < Bins; b++)
                {
                    if (w[b] <= 0) { r[b] = 0; continue; }
                    double a = (1 - pi) * Normal(x[b], m1, v1), c = pi * Normal(x[b], m2, v2);
                    r[b] = a + c > 0 ? c / (a + c) : (x[b] > (m1 + m2) / 2 ? 1 : 0);
                    n2 += w[b] * r[b];
                    sx2 += w[b] * r[b] * x[b];
                    sx1 += w[b] * (1 - r[b]) * x[b];
                }
                double n1 = n - n2;
                if (n1 <= 1e-9 || n2 <= 1e-9) break;
                double nm1 = sx1 / n1, nm2 = sx2 / n2, ss1 = 0, ss2 = 0;
                for (int b = 0; b < Bins; b++)
                {
                    ss1 += w[b] * (1 - r[b]) * (x[b] - nm1) * (x[b] - nm1);
                    ss2 += w[b] * r[b] * (x[b] - nm2) * (x[b] - nm2);
                }
                double floor = SilenceMixture.MinSd * SilenceMixture.MinSd;
                double nv1 = Math.Max(ss1 / n1 + BinWidth * BinWidth / 12, floor);
                double nv2 = Math.Max(ss2 / n2 + BinWidth * BinWidth / 12, floor);
                double npi = n2 / n;
                bool done = Math.Abs(nm1 - m1) + Math.Abs(nm2 - m2) + Math.Abs(npi - pi) < 1e-9;
                m1 = nm1; m2 = nm2; v1 = nv1; v2 = nv2; pi = npi;
                if (done) break;
            }
            if (m2 < m1) { double t = m1; m1 = m2; m2 = t; t = v1; v1 = v2; v2 = t; pi = 1 - pi; }
            m.MuShort = m1; m.SdShort = Math.Sqrt(v1);
            m.MuLong = m2; m.SdLong = Math.Sqrt(v2);
            m.PiLong = pi;
            m.Separation = Math.Sqrt(2) * (m2 - m1) / Math.Sqrt(v1 + v2);
            if (m.Separation < policy.MinSeparation) { m.Reason = "one continuous population"; return m; }
            if (pi < policy.MinLongShare || pi > policy.MaxLongShare) { m.Reason = "long population not a minority"; return m; }

            // Shape-free check: Gaussian components can split ONE skewed population (e.g. studying
            // times spread evenly over 1-8 minutes gives D ~ 2.0). Require an actual valley in the
            // observed histogram at the boundary: the smoothed density there must be at most
            // MaxValleyRatio of the LOWER of the two peaks on either side.
            m.Valid = true;                                       // provisional, for BoundarySeconds
            int bb = (int)Math.Floor((Math.Log(m.BoundarySeconds) - LnMin) / BinWidth);
            m.Valid = false;
            if (bb <= 0 || bb >= Bins - 1) { m.Reason = "no valley"; return m; }
            double Smooth(int b) => (w[Math.Max(0, b - 1)] + w[b] + w[Math.Min(Bins - 1, b + 1)]) / 3.0;
            double peakShort = 0, peakLong = 0;
            for (int b = 0; b < bb; b++) peakShort = Math.Max(peakShort, Smooth(b));
            for (int b = bb + 1; b < Bins; b++) peakLong = Math.Max(peakLong, Smooth(b));
            m.ValleyRatio = Smooth(bb) / Math.Max(1e-12, Math.Min(peakShort, peakLong));
            if (m.ValleyRatio > policy.MaxValleyRatio) { m.Reason = "no valley between the populations"; return m; }
            m.Valid = true;
            m.Reason = "two separated populations";
            return m;
        }

        private static double Normal(double x, double mu, double v) =>
            Math.Exp(-(x - mu) * (x - mu) / (2 * v)) / Math.Sqrt(2 * Math.PI * v);

        private static double Quantile(double[] x, double[] w, double n, double q)
        {
            double acc = 0;
            for (int b = 0; b < x.Length; b++) { acc += w[b]; if (acc >= q * n) return x[b]; }
            return x[x.Length - 1];
        }
    }

    public sealed class SilencePolicy
    {
        public double MinSilences = 40;     // effective count in the context
        public double MinSeparation = 2.0;  // Ashman's D: >= 2 means two clearly separated populations
        public double MinLongShare = 0.02;
        public double MaxLongShare = 0.5;   // departures are the minority of a context's silences
        public double DecideProbability = 0.9;
        public double MaxValleyRatio = 0.5;     // histogram valley at the boundary vs the lower peak
    }

    public struct SilenceMixture
    {
        public const double MinSd = 0.1;
        public int Context;
        public bool Valid;
        public string Reason;
        public double N, PiLong, MuShort, SdShort, MuLong, SdLong, Separation, ValleyRatio;

        private double Raw(double lnSeconds)
        {
            double a = (1 - PiLong) * Math.Exp(-Sq(lnSeconds - MuShort) / (2 * SdShort * SdShort)) / SdShort;
            double c = PiLong * Math.Exp(-Sq(lnSeconds - MuLong) / (2 * SdLong * SdLong)) / SdLong;
            return a + c > 0 ? c / (a + c) : (lnSeconds > (MuShort + MuLong) / 2 ? 1 : 0);
        }

        private static double Sq(double v) => v * v;

        /// <summary>
        /// P(the silence belongs to the "away" population | it lasted <paramref name="seconds"/>).
        /// Made monotone above the long population's centre, so that a very long silence can never
        /// look more "present" than a medium one because of Gaussian tail shapes. 0 if not Valid.
        /// </summary>
        public double PosteriorAway(double seconds)
        {
            if (!Valid || !(seconds > 0)) return 0;
            double x = Math.Log(seconds);
            double p = Raw(x);
            if (x > MuLong) p = Math.Max(p, Raw(MuLong));
            return p;
        }

        /// <summary>Silence length at which "away" becomes the more likely population (NaN if not Valid).</summary>
        public double BoundarySeconds
        {
            get
            {
                if (!Valid) return double.NaN;
                double lo = MuShort, hi = MuLong;
                for (int k = 0; k < 60; k++)
                {
                    double mid = (lo + hi) / 2;
                    if (Raw(mid) >= 0.5) hi = mid; else lo = mid;
                }
                return Math.Exp(hi);
            }
        }

        public string Describe() => !Valid
            ? string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0}: n={1:F0}, cannot tell ({2})",
                SilenceProfile.ContextNames[Context], N, Reason ?? "-")
            : string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "{0}: n={1:F0}, at the desk typically {2:F0} s, away typically {3:F0} s ({4:P0} of silences), boundary {5:F0} s, separation D={6:F1}, valley {7:P0}",
                SilenceProfile.ContextNames[Context], N, Math.Exp(MuShort), Math.Exp(MuLong), PiLong, BoundarySeconds, Separation, ValleyRatio);
    }
}
