using System;
using System.Collections.Generic;
using PresenceLock.Core;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// Second-by-second simulation of a user against the FULL decision flow
    /// (PresenceCoordinator + engine), including videos and meetings. Deterministic (same LCG
    /// as UserSim). Truth is known to the simulator, so wrong labels and unattended exposure
    /// can be measured exactly.
    ///
    /// Per simulated day (shuffled): 10 silent reading pauses, 2 read-then-leave, 3 abrupt
    /// departures, 2 Win+L, 3 visible videos watched in full (4–25 min, no input), 1 departure
    /// while a video keeps playing (autoplay 0–20 min), 1 meeting listened to silently
    /// (5–20 min), 1 departure from a running meeting (it continues 5–15 min).
    ///
    /// Assumption (stated, not hidden): a PRESENT user notices a visible dim within 1 s.
    /// </summary>
    internal sealed class CoordinatorSim
    {
        private const long Sec = TimeSpan.TicksPerSecond;

        public sealed class Stats
        {
            public int PresenceEpisodes, DimsOnPresent, LocksOnPresent;   // episodes where the user is at the desk at first
            public int MediaEpisodes, MediaDimsOnPresent;                 // all episodes with a video/meeting running
            public int Departures, LockedDepartures, UnlockedReturns;
            public List<int> Exposure = new List<int>();          // unattended & unlocked seconds per departure
            public List<int> PlainDepartureExposure = new List<int>(); // departures with no media/meeting running
            public int WrongAbsenceLabels;                            // "away" label while the user was present
        }

        public readonly Stats Learning = new Stats(), Enforcing = new Stats();
        public int? PromotedDay;
        public readonly UserProfile Profile = new UserProfile();
        public readonly PresenceCoordinator Co;

        private readonly bool _useSignals;
        private readonly int _forceEnforcingFromDay;
        private ModePolicy _policy = ModePolicy.Auto;
        private long _now, _lastInput;
        private PassiveSignals _sig;
        private FeatureVector _current = new FeatureVector();

        public CoordinatorSim(bool useSignals, int forceEnforcingFromDay = -1, CoordinatorConfig cfg = null)
        {
            _useSignals = useSignals;
            _forceEnforcingFromDay = forceEnforcingFromDay;
            Co = new PresenceCoordinator(new PresenceEngine(Profile), cfg ?? new CoordinatorConfig());
        }

        private double Idle => (_now - _lastInput) / (double)Sec;
        private FeatureVector Signature() => _current.Clone();

        private CoordinatorResult Step() =>
            Co.Tick(_now, Idle, _useSignals ? _sig : default(PassiveSignals), _policy, Signature);

        private void Input() { _lastInput = _now; _sig = default(PassiveSignals); Step(); }

        private Stats Phase => Co.Engine.Mode == OperatingMode.Enforcing ? Enforcing : Learning;

        private static FeatureVector Neutral() => new FeatureVector();   // e.g. a browser in front

        /// <param name="presentFor">seconds the user stays (silently) at the desk</param>
        /// <param name="awayFor">null: the user then simply resumes; else seconds away after leaving</param>
        /// <param name="signal">passive signal while active</param>
        /// <param name="signalFor">seconds (from episode start) the signal stays active</param>
        private void Episode(FeatureVector sig, int presentFor, int? awayFor, PassiveSignals signal, int signalFor)
        {
            var st = Phase;
            bool departing = awayFor.HasValue, media = signalFor > 0;
            if (departing) st.Departures++;
            if (presentFor > 0) st.PresenceEpisodes++;
            if (media) st.MediaEpisodes++;
            _current = sig;

            int t = 0;
            while (true)
            {
                t++;
                _now += Sec;
                _sig = t <= signalFor ? signal : default(PassiveSignals);
                bool present = t <= presentFor;
                int before = Profile.Modes.ConfirmedPositives;
                var r = Step();
                if (present && Profile.Modes.ConfirmedPositives > before) st.WrongAbsenceLabels++;

                if (r.Action == CoordinatorAction.SoftDim && present)
                {
                    st.DimsOnPresent++;
                    if (media) st.MediaDimsOnPresent++;
                    _now += Sec;
                    Input();                                   // 1 mm nudge, keeps working
                    return;
                }
                if (r.Action == CoordinatorAction.Lock)
                {
                    Co.OnSessionLocked(_now, Idle, Signature);
                    if (present)
                    {
                        st.LocksOnPresent++;
                        _now += 5 * Sec;                       // PIN, annoyed
                    }
                    else
                    {
                        st.LockedDepartures++;
                        int exposure = t - presentFor;
                        st.Exposure.Add(exposure);
                        if (!media) st.PlainDepartureExposure.Add(exposure);
                        _now += Math.Max(1, presentFor + awayFor.Value - t) * Sec;
                    }
                    Co.OnSessionUnlocked(_now);
                    _lastInput = _now;
                    return;
                }
                if (!departing && t >= presentFor) { Input(); return; }
                if (departing && t >= presentFor + awayFor.Value)
                {
                    st.UnlockedReturns++;                      // came back to an UNLOCKED machine
                    st.Exposure.Add(awayFor.Value);
                    if (!media) st.PlainDepartureExposure.Add(awayFor.Value);
                    Input();
                    return;
                }
            }
        }

        private void ManualLock(UserSim.Lcg rng)
        {
            Phase.Departures++;
            Phase.LockedDepartures++;
            Phase.Exposure.Add(0);
            _current = UserSim.LeavingSig();
            _now += Sec;
            _lastInput = _now;                                 // the Win+L keystroke itself
            _now += Sec;
            Co.OnSessionLocked(_now, Idle, Signature);
            _now += rng.UniformInt(300, 900) * Sec;
            Co.OnSessionUnlocked(_now);
            _lastInput = _now;
        }

        public CoordinatorSim Run(int days, long seed)
        {
            var rng = new UserSim.Lcg(seed);
            var video = new PassiveSignals { DisplayRequired = true };
            var meeting = new PassiveSignals { MicrophoneInUse = true };

            for (int day = 0; day < days; day++)
            {
                if (_forceEnforcingFromDay >= 0 && day >= _forceEnforcingFromDay) _policy = ModePolicy.ForceEnforcing;
                _now = UserSim.BaseTicks + day * TimeSpan.TicksPerDay + 8L * 3600 * Sec;
                Input();

                var kinds = new List<string>();
                void Add(string k, int n) { for (int i = 0; i < n; i++) kinds.Add(k); }
                Add("read", 10); Add("read_then_leave", 2); Add("leave", 3); Add("manual", 2);
                Add("video", 3); Add("leave_during_video", 1); Add("meeting", 1); Add("leave_meeting", 1);
                for (int i = kinds.Count - 1; i > 0; i--)
                {
                    int j = (int)(rng.Next() % (i + 1));
                    var tmp = kinds[i]; kinds[i] = kinds[j]; kinds[j] = tmp;
                }

                foreach (var k in kinds)
                {
                    switch (k)
                    {
                        case "read":
                            Episode(UserSim.ReadingSig(), rng.UniformInt(15, 100), null, default(PassiveSignals), 0); break;
                        case "read_then_leave":
                        {
                            int d = rng.UniformInt(10, 60), away = rng.UniformInt(300, 900);
                            Episode(UserSim.ReadingSig(), d, away, default(PassiveSignals), 0); break;
                        }
                        case "leave":
                            Episode(UserSim.LeavingSig(), 0, rng.UniformInt(300, 900), default(PassiveSignals), 0); break;
                        case "manual":
                            ManualLock(rng); break;
                        case "video":
                        {
                            int len = rng.UniformInt(240, 1500);
                            Episode(Neutral(), len, null, video, len); break;
                        }
                        case "leave_during_video":
                        {
                            int watch = rng.UniformInt(60, 300), autoplay = rng.UniformInt(0, 1200);
                            Episode(Neutral(), watch, 1800, video, watch + autoplay); break;
                        }
                        case "meeting":
                        {
                            int len = rng.UniformInt(300, 1200);
                            Episode(Neutral(), len, null, meeting, len); break;
                        }
                        default: // leave_meeting
                        {
                            int stay = rng.UniformInt(120, 600), rest = rng.UniformInt(300, 900);
                            Episode(Neutral(), stay, 1800, meeting, stay + rest); break;
                        }
                    }
                    _now += rng.UniformInt(30, 600) * Sec;
                    Input();
                }

                if (PromotedDay == null && Co.Engine.Mode == OperatingMode.Enforcing && _policy == ModePolicy.Auto)
                    PromotedDay = day;
            }
            return this;
        }
    }
}
