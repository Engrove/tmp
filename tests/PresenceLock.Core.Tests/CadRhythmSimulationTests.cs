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
            public int ShortPauses, ShortPausesDimmed, ShortPauseLocks;   // typing-rhythm pauses while drawing
            public List<int> CoffeeCueExposure = new List<int>(), CoffeeSilentExposure = new List<int>(), OtherExposure = new List<int>();
            public int[] StudiesDimmedByWeek = new int[12], StudiesByWeek = new int[12];
        }
        public readonly Phase Learning = new Phase(), Enforcing = new Phase();
        public readonly UserProfile Profile = new UserProfile();
        public readonly PresenceCoordinator Co;
        public int? PromotedDay;
        public string GateAtDay20 = "-";
        /// <summary>Called at 07:00 every simulated day (weekends too), before the user arrives.</summary>
        public Action<int, long> StartOfDay;
        private readonly int _forceFrom;
        private readonly bool _notice;
        private readonly UserSim.Lcg _rng;
        private long _now, _lastInput;
        public long Now => _now;
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
        /// <summary>Mid-drawing in Inventor: a reading-list app, ordinary pointer motion.</summary>
        public static FeatureVector Drawing() { var f = new FeatureVector(); f.X[FeatureSchema.CtxReading] = 1; f.X[FeatureSchema.Deceleration] = 0.3; f.X[FeatureSchema.ScrollFrac] = 0.1; return f; }
        public static FeatureVector CoffeeCue() { var f = Study(); f.X[FeatureSchema.AbruptStop] = 1; f.X[FeatureSchema.MicroJerk] = 1; f.X[FeatureSchema.Deceleration] = 0; return f; }

        private Phase P => Co.Engine.Mode == OperatingMode.Enforcing ? Enforcing : Learning;
        private double Idle => (_now - _lastInput) / (double)Sec;
        private CoordinatorResult Step() => Co.Tick(_now, Idle, default(PassiveSignals), _policy, () => _sig.Clone());
        private void Input() { _lastInput = _now; Step(); }
        /// <summary>
        /// Drawing for 'seconds': 5-60 s of input, then a 2-29 s pause at the desk, repeated (field profile
        /// 2026-11-13: ~73 idle episodes per active hour, >= 85 % under 30 s). Until 0.7.1 drawing had
        /// no pauses at all, so the gate was never tested against the episodes real users produce.
        /// </summary>
        private void Work(int seconds)
        {
            long end = _now + seconds * Sec;
            while (true)
            {
                _now += _rng.UniformInt(5, 60) * Sec;
                if (_now >= end) { _now = end; Input(); return; }
                Input();
                var ph = P;
                ph.ShortPauses++;
                var keep = _sig;
                _sig = Drawing();
                int pause = _rng.UniformInt(2, 29);
                for (int t = 1; t <= pause; t++)
                {
                    _now += Sec;
                    var r = Step();
                    if (r.Action == CoordinatorAction.SoftDim || (r.Action == CoordinatorAction.WouldLockNotice && _notice))
                    { ph.ShortPausesDimmed++; _now += Sec; break; }
                    if (r.Action == CoordinatorAction.Lock)
                    {
                        ph.ShortPauseLocks++;
                        Co.OnSessionLocked(_now, Idle, () => _sig.Clone());
                        _now += 5 * Sec;
                        Co.OnSessionUnlocked(_now);
                        break;
                    }
                }
                Input();
                _sig = keep;
            }
        }

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
                StartOfDay?.Invoke(day, At(day, 7, 0));                               // e.g. the cleaning service
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
            _out.WriteLine($"  ambiguous invisible decisions judged by the silence profile: away {s.Profile.Stats.AmbiguousScoredAway}, " +
                           $"undecidable (counted as possible false dims) {s.Profile.Stats.AmbiguousScoredUnknown}; " +
                           s.Profile.Silence.Fit(1, s.Now).Describe());
            _out.WriteLine($"  Kaizen: {s.Profile.Guard.Describe()}; {s.Profile.Quality.Describe(s.Profile.Modes)}");
            _out.WriteLine($"  learned lock time t(90%): studying {tStudy:F0} s, reading mail {tMail:F0} s, coffee with leave cues {tCue:F0} s");
            string weekly = string.Join(" ", Enumerable.Range(3, 6).Select(w => E.StudiesByWeek[w] == 0 ? "-" : $"{E.StudiesDimmedByWeek[w] * 100 / E.StudiesByWeek[w]}%"));
            _out.WriteLine($"  ENFORCING: studies dimmed {E.StudiesDimmed}/{E.Studies}, per week: {weekly}; mails dimmed {E.MailsDimmed}/{E.Mails}; HARD locks on present {E.HardLocksOnPresent}");
            _out.WriteLine($"  typing-rhythm pauses (< 30 s): learning {L.ShortPauses} (visible {L.ShortPausesDimmed}), enforcing {E.ShortPauses} (dimmed {E.ShortPausesDimmed}, locked {E.ShortPauseLocks}); " +
                           $"gate: {s.Profile.Modes.Explain(s.Now)}");
            _out.WriteLine($"  coffee with leave cues: {Med(E.CoffeeCueExposure)}; coffee indistinguishable from studying: {Med(E.CoffeeSilentExposure)}; lunch: {Med(E.OtherExposure)}");
        }

        private static CoordinatorConfig Legacy() => new CoordinatorConfig { RetrospectiveLearning = false, LearnedHorizon = false };

        /// <summary>
        /// Acceptance for the user's Inventor scenario with default settings, no forced mode.
        /// Regression guards: the bounds were set from the values measured in v0.5 (in brackets).
        /// </summary>
        [Theory]
        [InlineData(false, 7)] [InlineData(true, 7)] [InlineData(false, 3)] [InlineData(false, 11)]
        public void StudyingInInventor_NaturalPromotion(bool notice, long seed)
        {
            var cfg = new CoordinatorConfig();
            var s = new CadRhythmSim(cfg, notice, -1, seed).Run(63);
            Report($"AFTER, default config (cap {cfg.MaxLearnedHorizonSeconds} s), seed {seed}, 'Visa låsning' {(notice ? "ON" : "off")}", s);
            var E = s.Enforcing;
            Assert.Equal(0, s.Learning.WrongAwayLabels + E.WrongAwayLabels);          // [0]   was 537
            Assert.NotNull(s.PromotedDay);
            Assert.True(s.PromotedDay <= 30, $"promoted day {s.PromotedDay}");         // [21]  never before
            Assert.True(E.StudiesDimmed <= 0.05 * E.Studies, $"{E.StudiesDimmed}/{E.Studies}"); // [~1 %] was ~70 %
            Assert.Equal(0, E.HardLocksOnPresent);                                     // [0]
            Assert.Equal(0, E.ShortPauseLocks);                                        // 0.7.1: typing rhythm
            Assert.True(E.ShortPausesDimmed <= 0.01 * E.ShortPauses, $"{E.ShortPausesDimmed}/{E.ShortPauses}");
            int bound = (int)cfg.MaxLearnedHorizonSeconds + (int)cfg.ConfirmGraceSeconds + 2;
            Assert.All(E.CoffeeSilentExposure.Concat(E.CoffeeCueExposure).Concat(E.OtherExposure),
                       x => Assert.True(x <= bound, $"exposure {x} > {bound}"));       // [615]
            Assert.False(s.Profile.Quality.Degraded);                                  // Kaizen check: ok
            Assert.Equal(0, s.Profile.Guard.Rollbacks);                                // [0]
        }

        [Fact]
        public void StudyingInInventor_BeforeAndAfter()
        {
            foreach (bool notice in new[] { false, true })
            {
                Report($"BEFORE (fixed 180 s horizon), 'Visa låsning' {(notice ? "ON" : "off")}", new CadRhythmSim(Legacy(), notice, 21, 7).Run(63));
                foreach (int cap in new[] { 180, 300, 600, 900 })
                    Report($"AFTER (retrospective learning, learned horizon cap {cap} s), 'Visa låsning' {(notice ? "ON" : "off")}",
                           new CadRhythmSim(new CoordinatorConfig { MaxLearnedHorizonSeconds = cap }, notice, 21, 7).Run(63));
            }
        }
    
        /// <summary>
        /// 0.7.2, F4 (decision support, no assertion): the GPO floor MinLockIdleSeconds for the Inventor
        /// user. A floor delays departures with leave cues and removes early dims.
        /// </summary>
        [Fact]
        public void MinLockIdle_TradeOff_Report()
        {
            _out.WriteLine("floor | promoted | studies dimmed (enforcing) | mails dimmed | short pauses dimmed | coffee with cues: median/max | lunch: median/max | silent coffee: max");
            foreach (int floor in new[] { 0, 60, 120, 180 })
            {
                var s = new CadRhythmSim(new CoordinatorConfig { MinLockIdleSeconds = floor }, false, -1, 7).Run(63);
                var E = s.Enforcing;
                string Mm(List<int> v) => v.Count == 0 ? "-" : $"{v.OrderBy(x => x).ElementAt(v.Count / 2)}/{v.Max()} s";
                _out.WriteLine($"{floor,5} | {s.PromotedDay?.ToString() ?? "no",8} | {E.StudiesDimmed,5}/{E.Studies} | {E.MailsDimmed}/{E.Mails} | {E.ShortPausesDimmed}/{E.ShortPauses} | " +
                               $"{Mm(E.CoffeeCueExposure)} | {Mm(E.OtherExposure)} | {(E.CoffeeSilentExposure.Count == 0 ? 0 : E.CoffeeSilentExposure.Max())} s");
                Assert.Equal(0, E.HardLocksOnPresent);
            }
        }
    }
}
