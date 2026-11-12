using System;
using System.Collections.Generic;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// The user's own scenario: an Inventor user who draws, studies the model WITHOUT touching
    /// anything for 1-8 minutes, draws again, reads mail silently, takes coffee breaks (half of
    /// them indistinguishable by kinematics from studying: they just stand up from Inventor), lunch,
    /// home. Does the agent learn that "studying" is presence?
    /// </summary>
    internal sealed class CadRhythmSim
    {
        private const long Sec = TimeSpan.TicksPerSecond;
        public sealed class Phase
        {
            public int Studies, StudiesDimmed, HardLocksOnPresent, WrongAwayLabels;
            public int Mails, MailsDimmed, NoticesShown;
            public List<int> CoffeeCueExposure = new List<int>(), CoffeeSilentExposure = new List<int>(), OtherExposure = new List<int>();
            public int[] StudiesDimmedByWeek = new int[12], StudiesByWeek = new int[12];
        }
        public readonly Phase Learning = new Phase(), Enforcing = new Phase();
        public readonly UserProfile Profile = new UserProfile();
        public readonly PresenceCoordinator Co;
        public int? PromotedDay;
        public string GateAtDay20 = "-";
        private readonly int _forceFrom;
        private readonly bool _notice;
        private readonly UserSim.Lcg _rng;
        private long _now, _lastInput;
        private FeatureVector _sig = new FeatureVector();
        private ModePolicy _policy = ModePolicy.Auto;
        private int _week;

        public CadRhythmSim(CoordinatorConfig cfg, bool noticeEnabled, int forceEnforcingFromDay, long seed)
        {
            cfg.Habits = new HabitJournal();
            cfg.UtcOffsetMinutes = _ => 0;
            Co = new PresenceCoordinator(new PresenceEngine(Profile), cfg);
            _notice = noticeEnabled;
            _forceFrom = forceEnforcingFromDay;
            _rng = new UserSim.Lcg(seed);
        }

        public static FeatureVector Study() { var f = new FeatureVector(); f.X[FeatureSchema.CtxReading] = 1; f.X[FeatureSchema.Deceleration] = 0.7; f.X[FeatureSchema.ScrollFrac] = 0.2; return f; }
        public static FeatureVector Mail() { var f = new FeatureVector(); f.X[FeatureSchema.CtxLeaving] = 1; f.X[FeatureSchema.ScrollFrac] = 0.5; f.X[FeatureSchema.Deceleration] = 0.6; return f; }
        public static FeatureVector CoffeeCue() { var f = Study(); f.X[FeatureSchema.AbruptStop] = 1; f.X[FeatureSchema.MicroJerk] = 1; f.X[FeatureSchema.Deceleration] = 0; return f; }

        private Phase P => Co.Engine.Mode == OperatingMode.Enforcing ? Enforcing : Learning;
        private double Idle => (_now - _lastInput) / (double)Sec;
        private CoordinatorResult Step() => Co.Tick(_now, Idle, default(PassiveSignals), _policy, () => _sig.Clone());
        private void Input() { _lastInput = _now; Step(); }
        private void Work(int seconds) { _now += seconds * Sec; Input(); }

        /// <summary>present: silent but at the desk for 'seconds', then touches the mouse.
        /// away: leaves for 'seconds' (returns, unlocking if needed).</summary>
        private void Episode(FeatureVector sig, int seconds, bool present, string kind)
        {
            var ph = P;
            _sig = sig;
            if (kind == "study") { ph.Studies++; ph.StudiesByWeek[_week]++; }
            if (kind == "mail") ph.Mails++;
            bool dimmedThisEpisode = false;
            for (int t = 1; ; t++)
            {
                _now += Sec;
                int before = Profile.Modes.ConfirmedPositives;
                var r = Step();
                if (present && Profile.Modes.ConfirmedPositives > before) ph.WrongAwayLabels++;

                bool visible = r.Action == CoordinatorAction.SoftDim
                               || (r.Action == CoordinatorAction.WouldLockNotice && _notice);
                if (r.Action == CoordinatorAction.WouldLockNotice && _notice) ph.NoticesShown++;
                if (present && visible)
                {
                    if (!dimmedThisEpisode)
                    {
                        if (kind == "study") { ph.StudiesDimmed++; ph.StudiesDimmedByWeek[_week]++; }
                        if (kind == "mail") ph.MailsDimmed++;
                    }
                    dimmedThisEpisode = true;
                    bool reacts = r.Action == CoordinatorAction.SoftDim || _rng.UniformInt(1, 10) <= 7;  // toast: 70 %
                    if (reacts) { _now += 2 * Sec; Input(); seconds -= t + 2; if (seconds <= 0) return; _sig = sig; t = 0; continue; }
                }
                if (r.Action == CoordinatorAction.Lock)
                {
                    Co.OnSessionLocked(_now, Idle, () => _sig.Clone());
                    if (present) { ph.HardLocksOnPresent++; _now += 5 * Sec; }
                    else
                    {
                        Exposure(ph, kind).Add(t);
                        _now += Math.Max(1, seconds - t) * Sec;
                    }
                    Co.OnSessionUnlocked(_now);
                    _lastInput = _now;
                    return;
                }
                if (t >= seconds)
                {
                    if (!present) Exposure(ph, kind).Add(seconds);   // came back to an unlocked PC
                    Input();
                    return;
                }
            }
        }

        private static List<int> Exposure(Phase ph, string kind) =>
            kind == "coffee_cue" ? ph.CoffeeCueExposure : kind == "coffee_silent" ? ph.CoffeeSilentExposure : ph.OtherExposure;

        private void DrawStudyUntil(long until)
        {
            while (_now < until)
            {
                Work(_rng.UniformInt(60, 300));                                    // drawing
                if (_rng.UniformInt(1, 4) == 1) Episode(Mail(), _rng.UniformInt(30, 180), true, "mail");
                else Episode(Study(), _rng.UniformInt(60, 480), true, "study");    // studying 1-8 min
            }
        }

        private void Coffee()
        {
            bool cue = _rng.UniformInt(1, 2) == 1;
            Episode(cue ? CoffeeCue() : Study(), _rng.UniformInt(480, 900), false, cue ? "coffee_cue" : "coffee_silent");
        }

        public CadRhythmSim Run(int days)
        {
            long origin = new DateTime(2026, 1, 5, 0, 0, 0, DateTimeKind.Utc).Ticks;   // Monday
            long At(int day, int h, int m) => origin + day * TimeSpan.TicksPerDay + (h * 60 + m) * 60 * Sec;
            for (int day = 0; day < days; day++)
            {
                if (day % 7 >= 5) continue;
                _week = Math.Min(11, day / 7);
                if (_forceFrom >= 0 && day >= _forceFrom) _policy = ModePolicy.ForceEnforcing;
                _now = At(day, 8, 0); Input();
                DrawStudyUntil(At(day, 10, 0)); Coffee();
                DrawStudyUntil(At(day, 11, 50));
                Episode(UserSim.LeavingSig(), _rng.UniformInt(2100, 3000), false, "lunch");
                DrawStudyUntil(At(day, 14, 30)); Coffee();
                DrawStudyUntil(At(day, 16, 45));
                _sig = UserSim.LeavingSig();
                _now += Sec; _lastInput = _now; _now += Sec;
                Co.OnSessionLocked(_now, Idle, () => _sig.Clone());                   // Win+L, home
                _now = At(day + 1, 8, 0);
                Co.OnSessionUnlocked(_now); _lastInput = _now;
                if (PromotedDay == null && Co.Engine.Mode == OperatingMode.Enforcing && _policy == ModePolicy.Auto) PromotedDay = day;
                if (day == 18)
                    GateAtDay20 = $"window FP {Profile.Modes.WindowFalsePositiveRate():P0}, upper95 {Profile.Modes.FalsePositiveUpperBound():P0}, " +
                                  $"confirmed departures {Profile.Modes.ConfirmedPositives}";
            }
            return this;
        }
    }

    public class CadRhythmSimulationTests
    {
        private readonly ITestOutputHelper _out;
        public CadRhythmSimulationTests(ITestOutputHelper o) { _out = o; }

        private static string Med(List<int> v) => v.Count == 0 ? "-" : $"median {v.OrderBy(x => x).ElementAt(v.Count / 2)} s, max {v.Max()} s (n={v.Count})";

        internal void Report(string name, CadRhythmSim s)
        {
            var m = s.Profile.Model;
            double tStudy = m.LockTime(CadRhythmSim.Study().X, 0.9, 3600), tMail = m.LockTime(CadRhythmSim.Mail().X, 0.9, 3600),
                   tCue = m.LockTime(CadRhythmSim.CoffeeCue().X, 0.9, 3600);
            var L = s.Learning; var E = s.Enforcing;
            _out.WriteLine($"=== {name}");
            _out.WriteLine($"  LEARNING: studies {L.Studies}, WRONG 'away' labels while studying/reading {L.WrongAwayLabels}, notices shown {L.NoticesShown}");
            _out.WriteLine($"  gate after 3 work weeks: {s.GateAtDay20}");
            _out.WriteLine($"  promoted on its own: day {s.PromotedDay?.ToString() ?? "no"}; at end: window FP rate {s.Profile.Modes.WindowFalsePositiveRate():P0}, upper95 {s.Profile.Modes.FalsePositiveUpperBound():P0}");
            _out.WriteLine($"  learned lock time t(90%): studying {tStudy:F0} s, reading mail {tMail:F0} s, coffee with leave cues {tCue:F0} s");
            string weekly = string.Join(" ", Enumerable.Range(3, 6).Select(w => E.StudiesByWeek[w] == 0 ? "-" : $"{E.StudiesDimmedByWeek[w] * 100 / E.StudiesByWeek[w]}%"));
            _out.WriteLine($"  ENFORCING: studies dimmed {E.StudiesDimmed}/{E.Studies}, per week: {weekly}; mails dimmed {E.MailsDimmed}/{E.Mails}; HARD locks on present {E.HardLocksOnPresent}");
            _out.WriteLine($"  coffee with leave cues: {Med(E.CoffeeCueExposure)}; coffee indistinguishable from studying: {Med(E.CoffeeSilentExposure)}; lunch: {Med(E.OtherExposure)}");
        }

        private static CoordinatorConfig Legacy() => new CoordinatorConfig { RetrospectiveLearning = false, LearnedHorizon = false };

        [Fact]
        public void StudyingInInventor_NaturalPromotion()
        {
            foreach (bool notice in new[] { false, true })
                Report($"AFTER, cap 600 s, NO forced enforcing, 'Visa låsning' {(notice ? "ON" : "off")}",
                       new CadRhythmSim(new CoordinatorConfig { MaxLearnedHorizonSeconds = 600 }, notice, -1, 7).Run(63));
        }

        [Fact]
        public void StudyingInInventor_BeforeAndAfter()
        {
            foreach (bool notice in new[] { false, true })
            {
                Report($"BEFORE (fixed 180 s horizon), 'Visa låsning' {(notice ? "ON" : "off")}", new CadRhythmSim(Legacy(), notice, 21, 7).Run(63));
                foreach (int cap in new[] { 300, 600, 900 })
                    Report($"AFTER (retrospective learning, learned horizon cap {cap} s), 'Visa låsning' {(notice ? "ON" : "off")}",
                           new CadRhythmSim(new CoordinatorConfig { MaxLearnedHorizonSeconds = cap }, notice, 21, 7).Run(63));
            }
        }
    }
}
