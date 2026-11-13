using System;

namespace PresenceLock.Core
{
    /// <summary>
    /// Passive operating-system state, read by the host without opening any device.
    /// null = the signal is not available on this machine (treated as "no evidence").
    /// </summary>
    public struct PassiveSignals
    {
        /// <summary>Some process holds a display-required power request (video playing,
        /// presentation, ...). Chromium only holds it while a video plays in a VISIBLE page.</summary>
        public bool? DisplayRequired;
        /// <summary>A running process currently has the microphone open.</summary>
        public bool? MicrophoneInUse;
        /// <summary>A running process currently has the camera open.</summary>
        public bool? CameraInUse;
        /// <summary>false = the input desktop is not the user's "Default" desktop (UAC secure
        /// desktop, lock screen): session input is not observable, idle means nothing.</summary>
        public bool? InputDesktopObservable;
    }

    public enum HoldReason { None, Media, Meeting, SecureDesktop, UserPause }

    public enum CoordinatorAction
    {
        None,
        /// <summary>Show the visible dim (enforcing only). See <see cref="CoordinatorResult.Cause"/>.</summary>
        SoftDim,
        /// <summary>Call LockWorkStation() (enforcing only). Report a refusal via OnLockRefused().</summary>
        Lock,
        /// <summary>The user is back (or a hold began): clear any dim immediately.</summary>
        CancelDim,
        /// <summary>Learning mode: the model would have locked now (optional "Visa låsning" notice).</summary>
        WouldLockNotice,
        /// <summary>
        /// Fallback when locks were requested but never confirmed by a session-lock event (refused,
        /// or no acknowledgement): disconnect the session (WTSDisconnectSession). A disconnected
        /// session needs authentication to reconnect, so it is as secure as a locked one.
        /// </summary>
        Disconnect
    }

    public enum LockCause { None, Model, Backstop, HoldProbe, Habit }

    public struct CoordinatorResult
    {
        public CoordinatorAction Action;
        public LockCause Cause;
        public HoldReason Hold;
        public OperatingMode Mode;
        public double Probability;
        public double EpisodeSeconds;
        public bool HabitLikelyGone;
        /// <summary>Kaizen events for the administrator (event log), never shown to the user.</summary>
        public QualityMonitor.Change QualityChange;
        public bool ModelRolledBack;
        /// <summary>This Lock/Disconnect is a RETRY: earlier requests were refused or never confirmed.</summary>
        public bool LockUnconfirmed;
        /// <summary>Which request for the current lock this is (1 = first).</summary>
        public int LockAttempt;
    }

    /// <summary>Runtime policy for the coordinator (from GPO; not part of the learned profile).</summary>
    public sealed class CoordinatorConfig
    {
        public double EpisodeStartIdleSeconds = 2.0;   // idle needed before an episode starts
        public double InputResumeIdleSeconds = 1.0;    // idle below this = the user just gave input
        public double ManualLockMaxIdleSeconds = 5.0;  // a lock this soon after input = Win+L
        public bool MediaHoldEnabled = true;
        public bool MeetingHoldEnabled = true;
        /// <summary>Absolute cap: after this much idle a visible confirmation dim is ALWAYS shown
        /// (enforcing), whatever the model or the passive signals say. Default 900 s, matching the
        /// common 15-minute machine-inactivity guidance.</summary>
        public double HoldMaxSeconds = 900.0;
        /// <summary>How long a confirmation dim (hold probe / backstop / habit) waits before locking.</summary>
        public double ConfirmGraceSeconds = 15.0;

        // Lock chain: a request is not a lock. Only the session-lock event (OnSessionLocked) or a
        // disconnect (OnSessionDisconnected) confirms it. All three are measured on the idle axis,
        // which only grows while nobody touches the computer, so a clock change cannot stretch them.
        /// <summary>No session-lock event this long after a request: request again.</summary>
        public double LockAckTimeoutSeconds = 10.0;
        /// <summary>After a refused request (LockWorkStation returned false): try again after this long.</summary>
        public double LockRetrySeconds = 15.0;
        /// <summary>After this many unconfirmed requests, use the fallback (Disconnect) instead of Lock.</summary>
        public int LockFallbackAfterAttempts = 3;

        /// <summary>
        /// Learning mode: a silence that ends with the user touching the computer again is AMBIGUOUS
        /// (studying a drawing, or a short errand?) and produces no "away" label; absence is only
        /// certain at HoldMax of idle, or decided by a Windows lock and how fast it was unlocked.
        /// false = legacy behaviour ("away" at the 180 s horizon), kept for comparison only.
        /// </summary>
        public bool RetrospectiveLearning = true;
        /// <summary>
        /// Enforcing mode: the certain-absence confirmation moves out to where the LEARNED model
        /// expects absence for this context (its soft-dim time), never earlier than 180 s and never
        /// later than MaxLearnedHorizonSeconds. false = fixed 180 s, kept for comparison only.
        /// </summary>
        public bool LearnedHorizon = true;
        /// <summary>Cap on the learned horizon (also bounds what an edited model can do). Clamped to HoldMax.</summary>
        public double MaxLearnedHorizonSeconds = 600.0;
        /// <summary>Champion/challenger supervision of the continuous learning (null = off).</summary>
        public ModelGuardPolicy ModelGuard = new ModelGuardPolicy();
        /// <summary>GPO "User pause" (menu choices, 24-hour budget, whether the HoldMax confirmation stays).</summary>
        public PausePolicy Pause = new PausePolicy();
        /// <summary>When the per-user silence profile may judge an ambiguous learning-mode decision.</summary>
        public SilencePolicy SilencePolicy = new SilencePolicy();

        // --- habits (null journal = habit learning off) --------------------------------
        public HabitJournal Habits;
        public HabitPolicy HabitPolicy = new HabitPolicy();
        /// <summary>Earliest idle at which a habit verdict may bring a confirmation dim forward.</summary>
        public double HabitEarlySeconds = 120.0;
        /// <summary>The user typed a PIN before the unlock event: return time uncertainty.</summary>
        public double UnlockUncertaintySeconds = 15.0;
        /// <summary>Local UTC offset in minutes at a UTC instant (DST-aware). Injectable for tests.</summary>
        public Func<long, int> UtcOffsetMinutes =
            ticks => (int)TimeZoneInfo.Local.GetUtcOffset(new DateTime(ticks, DateTimeKind.Utc)).TotalMinutes;
    }

    /// <summary>
    /// The complete decision flow around the learned engine, as pure logic (no OS calls, no
    /// timers) so it is unit-testable and simulatable. The Windows host calls Tick() once per
    /// second with idle time and passive signals and performs the returned action.
    ///
    /// Layers, in priority order:
    ///  1. INPUT        idle &lt; 1 s: the user is here. Resolve whatever was pending.
    ///  2. PASSIVE HOLD meeting / visible media / non-observable input desktop explains the
    ///                  stillness: the model is paused and the running episode DISCARDED (no label).
    ///  3. MODEL        the self-learning engine decides (soft-dim, lock).
    /// plus confirmation dims that override all three in enforcing mode:
    ///  BACKSTOP        certain-absence horizon (180 s episode time) or HoldMax total idle reached.
    ///  HABIT           this user's own routine says "not back within 10 min" (earned verdicts only):
    ///                  the confirmation may come EARLIER, from HabitEarlySeconds. Never a direct
    ///                  lock, never later than without habits (the model keeps deciding meanwhile).
    /// So no workstation stays unlocked longer than HoldMax + grace after the last input.
    ///
    /// Also records the habit journal: every idle period, from the last interaction until the
    /// next interaction (input or unlock/reconnect), as a duration interval.
    /// </summary>
    public sealed class PresenceCoordinator
    {
        private const long Tps = TimeSpan.TicksPerSecond;
        private readonly PresenceEngine _engine;
        private readonly UserProfile _p;
        private readonly CoordinatorConfig _c;

        private bool _inputSinceEpisode = true;
        private double _episodeOffset;          // idle seconds at which the current episode's clock started
        private HoldReason _hold;
        private bool _dimShown;
        private LockCause _confirm;             // confirmation dim in progress
        private long _confirmStartTicks;
        private LockCause _pendingLock;         // lock requested; confirmed by OnSessionLocked; verdict on unlock
        private long _pendingLockTicks;
        private int _lockAttempts;              // requests for the current lock
        private double _lastAttemptIdle;        // idle seconds at the last request (monotonic axis)
        private bool _lastAttemptRefused;
        private double _confirmStartIdle;       // idle seconds when the confirmation dim started
        private double _prevIdle;               // previous tick's idle: a DROP means input happened
        // Backstop/habit lock: the label waits for the unlock time, like a model lock (one rule for all causes).
        private FeatureVector _pendingSig;
        private bool _sessionLocked;
        private bool _suspendedByDisconnect;
        private double _episodeHorizon = -1;     // cached per episode
        private double _episodeT;                // last observed silence length of the model episode
        private bool _episodeIntervened;         // a visible dim was shown in this episode
        private double _lastIdle, _pendingLockIdle;
        // A Windows (not our, not Win+L) lock: the label waits for the unlock time.
        private FeatureVector _deferredSig;
        private bool _deferredFired;
        private long _deferredLockTicks;

        // habit episode
        private bool _hOpen, _hSuspended, _hHoldSeen, _hProbeShown, _hIssued;
        private long _hEntry, _hSuspendedAt;
        private int _hOffset;
        private HabitCohort _hCohort;
        private double _hProbeAge;
        private HabitActivityTable _hTable;
        private int _hTableRevision = -1;
        private long _hTableBuiltTicks;
        private bool _hEarned;
        private int _hEarnedRevision = -1;

        public PresenceCoordinator(PresenceEngine engine, CoordinatorConfig config)
        {
            _engine = engine ?? throw new ArgumentNullException(nameof(engine));
            _p = engine.Profile;
            _c = config ?? new CoordinatorConfig();
            _c.Habits?.Normalize();
            _engine.GuardPolicy = _c.ModelGuard;
        }

        public PresenceEngine Engine => _engine;
        public CoordinatorConfig Config => _c;
        public HoldReason CurrentHold => _hold;
        public LockCause PendingLock => _pendingLock;
        public bool HabitsEarned => HabitGateOpen();

        private static double Seconds(long ticks) => ticks / (double)Tps;

        /// <summary>Secure desktop first, then meeting, then media. Unavailable signals are no evidence.</summary>
        public HoldReason EvaluateHold(PassiveSignals s)
        {
            if (s.InputDesktopObservable == false) return HoldReason.SecureDesktop;
            if (_c.MeetingHoldEnabled && (s.MicrophoneInUse == true || s.CameraInUse == true)) return HoldReason.Meeting;
            if (_c.MediaHoldEnabled && s.DisplayRequired == true) return HoldReason.Media;
            return HoldReason.None;
        }

        /// <summary>
        /// Advance one step. <paramref name="signature"/> is only invoked when a new episode
        /// starts (it may be expensive: cursor position, foreground process).
        /// </summary>
        public CoordinatorResult Tick(long nowUtcTicks, double idleSeconds, PassiveSignals signals,
                                      ModePolicy policy, Func<FeatureVector> signature)
        {
            var r = new CoordinatorResult { Mode = _engine.Mode };
            if (_sessionLocked) { _prevIdle = 0; return r; }
            // Input is detected two ways: idle just reset (< 1 s), or idle DROPPED since the last
            // tick. The second catches input that happened between two ticks when the next tick
            // came late (timer delayed by I/O, a busy UI thread): idle is then already > 1 s.
            bool input = idleSeconds < _c.InputResumeIdleSeconds || idleSeconds + 0.25 < _prevIdle;
            _prevIdle = idleSeconds;
            _lastIdle = idleSeconds;
            bool enforcing = _engine.Mode == OperatingMode.Enforcing;

            // ---- 1. input: the user is here ------------------------------------------
            if (input)
            {
                _inputSinceEpisode = true;
                if (_pendingLock != LockCause.None) CancelUnconfirmedLock();
                switch (_confirm)
                {
                    case LockCause.HoldProbe: _p.Stats.HoldProbesAnswered++; break;
                    case LockCause.Backstop:
                        _p.Stats.BackstopAnswered++;
                        _engine.OnHorizonDimAnswered(nowUtcTicks);      // present at the horizon: y = 0
                        break;
                    case LockCause.Habit:
                        _p.Stats.HabitProbesAnswered++;
                        _engine.OnHorizonDimAnswered(nowUtcTicks);      // no-op if no model episode
                        break;
                }
                _confirm = LockCause.None;
                if (_engine.EpisodeActive) ResumeEpisode(nowUtcTicks);
                _hold = HoldReason.None;
                HabitReturnFromInput(nowUtcTicks, idleSeconds);
                if (_dimShown) { r.Action = CoordinatorAction.CancelDim; _dimShown = false; }
                return Finish(r, nowUtcTicks, policy, ticked: false);
            }

            // ---- 0. a lock was requested and is not confirmed yet ----------------------
            // Nothing else matters until the session is secured or the user is back. Retry on the
            // idle axis; after LockFallbackAfterAttempts requests, fall back to a disconnect.
            if (_pendingLock != LockCause.None)
            {
                double since = idleSeconds - _lastAttemptIdle;
                double wait = _lastAttemptRefused ? _c.LockRetrySeconds : _c.LockAckTimeoutSeconds;
                if (since >= wait)
                {
                    _lockAttempts++;
                    _lastAttemptIdle = idleSeconds;
                    _lastAttemptRefused = false;
                    _p.Stats.LockRetries++;
                    r.Action = _lockAttempts > _c.LockFallbackAfterAttempts ? CoordinatorAction.Disconnect : CoordinatorAction.Lock;
                    if (r.Action == CoordinatorAction.Disconnect) _p.Stats.LockFallbacks++;
                    r.Cause = _pendingLock;
                    r.LockUnconfirmed = true;
                    r.LockAttempt = _lockAttempts;
                }
                return Finish(r, nowUtcTicks, policy, ticked: false);
            }

            // ---- habit episode bookkeeping and verdict (shadow-evaluated always) ---------
            if (!_hOpen && idleSeconds >= _c.EpisodeStartIdleSeconds) HabitOpen(nowUtcTicks, idleSeconds);
            bool habitAct = HabitVerdict(nowUtcTicks, idleSeconds, out r.HabitLikelyGone) && enforcing
                            && idleSeconds >= _c.HabitEarlySeconds;

            // ---- confirmation dim in progress ------------------------------------------
            if (_confirm != LockCause.None)
            {
                bool ticked = false;
                // A habit confirmation must never delay the model: keep it deciding meanwhile.
                if (_confirm == LockCause.Habit && _engine.EpisodeActive)
                {
                    _engine.UpdateLive(idleSeconds - _episodeOffset);
                    var d = _engine.Tick(nowUtcTicks, policy);
                    ticked = true;
                    if (d.Action == DecisionAction.TriggerLock && d.Mode == OperatingMode.Enforcing)
                    {
                        _confirm = LockCause.None;
                        IssueLock(ref r, LockCause.Model, nowUtcTicks);
                        return Finish(r, nowUtcTicks, policy, ticked);
                    }
                }
                if (idleSeconds - _confirmStartIdle >= _c.ConfirmGraceSeconds)
                {
                    var cause = _confirm;
                    _confirm = LockCause.None;
                    switch (cause)
                    {
                        case LockCause.Backstop: _p.Stats.BackstopLocks++; break;
                        case LockCause.HoldProbe: _p.Stats.HoldProbeLocks++; break;
                        case LockCause.Habit: _p.Stats.HabitLocks++; break;
                    }
                    // An unanswered dim is not yet a verdict: the user may unlock within seconds
                    // (they were there). Keep the signature; the unlock time decides, exactly as for
                    // a model lock.
                    if (cause != LockCause.HoldProbe && _engine.EpisodeActive)
                    {
                        _pendingSig = _engine.CurrentSignature.Clone();
                        _pendingSig.IdleSeconds = idleSeconds - _episodeOffset;
                        _engine.AbortEpisode();
                    }
                    IssueLock(ref r, cause, nowUtcTicks);
                }
                r.Hold = _hold;
                return Finish(r, nowUtcTicks, policy, ticked);
            }

            // ---- 2. passive hold (and the user's own pause, which is handled as one) -----
            bool paused = PauseActive(nowUtcTicks);
            var hold = paused ? HoldReason.UserPause : EvaluateHold(signals);
            if (hold != HoldReason.None && idleSeconds >= _c.EpisodeStartIdleSeconds)
            {
                if (_engine.EpisodeActive)
                {
                    _engine.AbortEpisode();                // confounded episode: no label at all
                    _p.Stats.HoldAbortedEpisodes++;
                }
                if (_hold == HoldReason.None) _p.Stats.HoldStarts++;
                _hold = hold;
                _hHoldSeen = true;                          // habit journal: presence unknown
                r.Hold = hold;
                if (_dimShown) { r.Action = CoordinatorAction.CancelDim; _dimShown = false; }

                // A user pause keeps the absolute HoldMax confirmation unless policy says otherwise
                // (then only Windows' own lock settings apply), and habits never shorten it: the
                // user said explicitly that they are here.
                bool probe = hold != HoldReason.UserPause || _c.Pause.KeepConfirmation;
                if (probe && enforcing && idleSeconds >= _c.HoldMaxSeconds) StartConfirm(ref r, LockCause.HoldProbe, nowUtcTicks);
                else if (habitAct && hold != HoldReason.UserPause) StartConfirm(ref r, LockCause.Habit, nowUtcTicks);
                return Finish(r, nowUtcTicks, policy, ticked: false);
            }

            // ---- hold ended while the user is still idle: fresh episode from now ---------
            if (_hold != HoldReason.None)
            {
                _hold = HoldReason.None;
                var sig = signature();
                MarkPostHold(sig);
                _engine.BeginEpisode(sig, nowUtcTicks);
                _episodeOffset = idleSeconds;
                _episodeHorizon = -1; _episodeT = 0; _episodeIntervened = false;
                _inputSinceEpisode = false;
            }

            // ---- ordinary episode start ------------------------------------------------
            if (!_engine.EpisodeActive && _inputSinceEpisode && idleSeconds >= _c.EpisodeStartIdleSeconds)
            {
                _engine.BeginEpisode(signature(), nowUtcTicks);
                _episodeOffset = 0.0;
                _episodeHorizon = -1; _episodeT = 0; _episodeIntervened = false;
                _inputSinceEpisode = false;
            }

            // ---- safety floor: HoldMax applies whether or not a model episode is running ---
            if (enforcing && !_engine.EpisodeActive && idleSeconds >= _c.HoldMaxSeconds)
            {
                _p.Stats.BackstopDims++;
                StartConfirm(ref r, LockCause.Backstop, nowUtcTicks);
                return Finish(r, nowUtcTicks, policy, ticked: false);
            }

            // ---- 3. the learned model ---------------------------------------------------
            bool modelTicked = false;
            if (_engine.EpisodeActive)
            {
                double t = idleSeconds - _episodeOffset;
                r.EpisodeSeconds = t;
                _episodeT = t;
                _engine.UpdateLive(t);

                bool certain = idleSeconds >= _c.HoldMaxSeconds;
                bool backstop = t >= Horizon() || certain;
                if (enforcing && (backstop || habitAct))
                {
                    if (backstop) _p.Stats.BackstopDims++;
                    StartConfirm(ref r, backstop ? LockCause.Backstop : LockCause.Habit, nowUtcTicks);
                }
                else if (!enforcing && (_c.RetrospectiveLearning ? (certain || backstop) && !SilentWorkContext() : backstop))
                {
                    _p.Stats.AssumedAbsenceLabels++;
                    // Learning. In a silent-work application (CAD, PDF, IDE: the "reading" list) no
                    // length of silence is evidence of absence: the user may be studying a drawing.
                    // Such an episode resolves only by input (ambiguous: no label) or by a Windows
                    // lock and its unlock time (observed). Elsewhere, silence past the horizon or
                    // HoldMax is labelled "away" as an ASSUMPTION, counted separately (AssumedAbsenceLabels).
                    _engine.OnLongAbsence(nowUtcTicks);
                }
                else
                {
                    var d = _engine.Tick(nowUtcTicks, policy);
                    modelTicked = true;
                    r.Probability = d.Probability;
                    if (d.Action == DecisionAction.SoftDim && d.Mode == OperatingMode.Enforcing)
                    {
                        r.Action = CoordinatorAction.SoftDim;
                        r.Cause = LockCause.Model;
                        _dimShown = true;
                        _episodeIntervened = true;
                    }
                    else if (d.Action == DecisionAction.TriggerLock)
                    {
                        if (d.Mode == OperatingMode.Enforcing) IssueLock(ref r, LockCause.Model, nowUtcTicks);
                        else r.Action = CoordinatorAction.WouldLockNotice;
                    }
                }
            }
            return Finish(r, nowUtcTicks, policy, modelTicked);
        }

        /// <summary>
        /// Certain-absence horizon for the current episode: 180 s, or later where the learned model
        /// itself only expects absence later in this context (it has been taught by visible dims and
        /// quick unlocks that the user studies silently here), capped by MaxLearnedHorizon/HoldMax.
        /// </summary>
        private double Horizon()
        {
            if (_episodeHorizon >= 0) return _episodeHorizon;
            double h = _p.Config.LongAbsenceSeconds;
            var sig = _engine.CurrentSignature;
            if (_c.LearnedHorizon && sig != null)
            {
                double cap = Math.Min(_c.HoldMaxSeconds, Math.Max(h, _c.MaxLearnedHorizonSeconds));
                double learned = _p.Model.LockTime(sig.X, _p.Config.SoftDimThreshold, cap);
                h = Math.Min(cap, Math.Max(h, learned));
            }
            return _episodeHorizon = h;
        }

        /// <summary>
        /// The user touched the computer during a model episode. Feed the silence profile (only
        /// silences that ended on their own: no dim shown, not after a media/meeting hold) and let it
        /// judge an invisible learning-mode decision whose truth is unknown.
        /// </summary>
        private void ResumeEpisode(long nowUtcTicks)
        {
            var sig = _engine.CurrentSignature;
            bool natural = !_episodeIntervened && sig != null && sig.X[FeatureSchema.PostHold] < 0.5;
            int ctx = SilenceProfile.ContextOf(sig);
            double d = _episodeT;
            var silence = _p.Silence;
            _engine.OnInputResumed(nowUtcTicks, () =>
            {
                bool away = natural && silence != null
                            && silence.Fit(ctx, nowUtcTicks, _c.SilencePolicy).PosteriorAway(d) >= _c.SilencePolicy.DecideProbability;
                if (away) _p.Stats.AmbiguousScoredAway++; else _p.Stats.AmbiguousScoredUnknown++;
                return away;
            });
            if (natural && silence != null) silence.Record(ctx, d, nowUtcTicks);   // after judging: prequential
        }

        /// <summary>
        /// The user came back while a requested lock was still not confirmed: nothing was locked,
        /// so there is no verdict. The time the computer stood unlocked is real exposure.
        /// </summary>
        private void CancelUnconfirmedLock()
        {
            if (_pendingLock == LockCause.Model) _engine.DiscardEnforcedLock();
            _p.Stats.LocksNeverConfirmed++;
            _p.Quality?.RecordExposure(_pendingLockIdle + Math.Max(0, _lastIdle - _lastAttemptIdle));
            _pendingLock = LockCause.None;
            _pendingSig = null;
            _lockAttempts = 0;
        }

        public bool PauseActive(long nowUtcTicks) =>
            _c.Pause != null && _c.Pause.Enabled && _p.Pause != null && _p.Pause.IsActive(nowUtcTicks, _c.Pause);

        /// <summary>Menu: start a pause. The budget and the allowed lengths are enforced here, not in the UI.</summary>
        public bool TryStartPause(int minutes, long nowUtcTicks, out string reason)
        {
            if (_p.Pause == null) _p.Pause = new PauseLedger();
            if (!_p.Pause.TryStart(minutes, nowUtcTicks, _c.Pause, out reason)) return false;
            _confirm = LockCause.None;                         // the user is demonstrably here
            return true;
        }

        public double EndPause(long nowUtcTicks) => _p.Pause?.End(nowUtcTicks) ?? 0;

        private bool SilentWorkContext()
        {
            var sig = _engine.CurrentSignature;
            return sig != null && sig.X[FeatureSchema.CtxReading] >= 0.5;
        }

        private void StartConfirm(ref CoordinatorResult r, LockCause cause, long now)
        {
            _confirm = cause;
            _confirmStartTicks = now;
            _confirmStartIdle = _lastIdle;
            if (cause == LockCause.HoldProbe) _p.Stats.HoldProbes++;
            if (cause == LockCause.Habit && !_hProbeShown)
            {
                _p.Stats.HabitProbes++;
                _hProbeShown = true;
                _hProbeAge = Seconds(now - _hEntry);
            }
            else if (cause == LockCause.Habit) _p.Stats.HabitProbes++;
            r.Action = CoordinatorAction.SoftDim;
            r.Cause = cause;
            _dimShown = true;
            _episodeIntervened = true;
        }

        private void IssueLock(ref CoordinatorResult r, LockCause cause, long now)
        {
            r.Action = CoordinatorAction.Lock;
            r.Cause = cause;
            r.LockAttempt = 1;
            _pendingLock = cause;
            _pendingLockTicks = now;
            _pendingLockIdle = _lastIdle;
            _lockAttempts = 1;
            _lastAttemptIdle = _lastIdle;
            _lastAttemptRefused = false;
            _p.Stats.LockRequests++;
            _dimShown = false;
        }

        private CoordinatorResult Finish(CoordinatorResult r, long now, ModePolicy policy, bool ticked)
        {
            // Keep the promotion gate evaluated even when no episode is being decided.
            // Never tick an active episode here: that would run its state machine twice.
            if (!ticked && !_engine.EpisodeActive) _engine.Tick(now, policy);
            r.Mode = _engine.Mode;
            if (_engine.LastGuardVerdict == ModelGuard.Verdict.RolledBack) r.ModelRolledBack = true;
            _engine.LastGuardVerdict = ModelGuard.Verdict.None;
            if (_p.Quality == null) _p.Quality = new QualityMonitor();
            r.QualityChange = _p.Quality.Evaluate(_p.Modes, now);
            return r;
        }

        /// <summary>Kinematics are minutes old after a hold: zero them and flag the episode.</summary>
        public static void MarkPostHold(FeatureVector f)
        {
            foreach (int i in FeatureSchema.Kinematic) f.X[i] = 0.0;
            f.X[FeatureSchema.PostHold] = 1.0;
        }

        // ---------------------------------------------------------------- habit journal

        private void HabitOpen(long now, double idle)
        {
            if (_c.Habits == null) return;
            _hOpen = true;
            _hSuspended = _hHoldSeen = _hProbeShown = _hIssued = false;
            _hEntry = now - (long)(idle * Tps);
            _hOffset = _c.UtcOffsetMinutes(_hEntry);
            _hCohort = null;
        }

        private bool HabitGateOpen()
        {
            var j = _c.Habits;
            if (j == null) return false;
            if (_hEarnedRevision != j.Revision)
            {
                _hEarned = HabitModel.Earned(j, _c.HabitPolicy, out _, out _, out _);
                _hEarnedRevision = j.Revision;
            }
            return _hEarned;
        }

        private HabitActivityTable Table(long now)
        {
            var j = _c.Habits;
            if (_hTable == null || _hTableRevision != j.Revision || now - _hTableBuiltTicks > TimeSpan.TicksPerHour)
            {
                _hTable = HabitModel.BuildActivityTable(j, now, _c.HabitPolicy);
                _hTableRevision = j.Revision;
                _hTableBuiltTicks = now;
            }
            return _hTable;
        }

        /// <summary>
        /// The habit verdict for the open episode at idle <paramref name="age"/>: a deterministic
        /// function of history BEFORE the episode started (routine forecast) and of the clock
        /// (off-hours). Returns (score source, predicted probability) or source 0 if not "likely gone".
        /// </summary>
        private byte VerdictAt(double age, out double predicted)
        {
            predicted = 0;
            var hp = _c.HabitPolicy;
            if (age < hp.MinRecordSeconds) return 0;
            if (_hCohort == null) _hCohort = HabitModel.Fit(_c.Habits, _hEntry, _hOffset, hp);
            var routine = HabitModel.Routine(_hCohort, age, hp);
            if (routine.LikelyGone) { predicted = (routine.Lower + routine.Upper) / 2; return 1; }
            long at = _hEntry + (long)(age * Tps);
            if (HabitModel.IsOffHours(Table(at), at, _c.UtcOffsetMinutes(at), hp)) { predicted = 1 - hp.OffHoursRelativeRate; return 2; }
            return 0;
        }

        /// <summary>Live: is the user likely gone now, and may habits act on it?</summary>
        private bool HabitVerdict(long now, double age, out bool likelyGone)
        {
            likelyGone = false;
            if (_c.Habits == null || !_hOpen || _hSuspended) return false;
            likelyGone = VerdictAt(age, out _) != 0;
            if (likelyGone && !_hIssued) { _hIssued = true; _p.Stats.HabitVerdicts++; }   // shadow count
            return likelyGone && HabitGateOpen();
        }

        private void HabitReturnFromInput(long now, double idle)
        {
            if (!_hOpen) return;
            double d = Seconds(now - (long)(idle * Tps) - _hEntry);
            HabitClose(HabitEvidence.Bounded, Math.Max(0, d - 1), d + 1, now);
        }

        private void HabitReturnFromUnlock(long now)
        {
            if (!_hOpen || !_hSuspended) return;
            double d = Seconds(now - _hEntry);
            double lockedAt = Seconds(_hSuspendedAt - _hEntry);
            HabitClose(HabitEvidence.Bounded, Math.Max(lockedAt, d - _c.UnlockUncertaintySeconds), d, now);
        }

        private void HabitSuspend(long now, double idle)
        {
            if (_c.Habits == null) return;
            if (!_hOpen) HabitOpen(now, idle);
            if (!_hSuspended) { _hSuspended = true; _hSuspendedAt = now; }
        }

        private void HabitClose(HabitEvidence kind, double lower, double upper, long now)
        {
            var j = _c.Habits;
            _hOpen = false;
            if (j == null) return;
            var hp = _c.HabitPolicy;
            // Presence during a hold (video, call) is unknown: the duration is not evidence of absence.
            var e = new HabitEpisode
            {
                EntryUtcTicks = _hEntry,
                OffsetMinutes = _hOffset,
                Lower = lower,
                Upper = kind == HabitEvidence.RightCensored ? -1 : upper,
                Kind = _hHoldSeen ? HabitEvidence.Hold : kind
            };
            // Prequential scoring. The verdict depends only on data from before this episode began and
            // on the clock, so the age at which it WOULD have fired can be found after the fact — even
            // when the model locked the session long before (a frozen live forecast gives the same
            // answer). Only ages at which the episode was DEFINITELY still idle are considered, and
            // censoring is never turned into an observed failure.
            double firedAt = -1, predicted = 0;
            byte source = 0;
            if (!_hHoldSeen)
            {
                double first = Math.Max(_c.HabitEarlySeconds, hp.MinRecordSeconds);
                double last = Math.Min(lower, first + 4 * 3600);
                for (double a = first; a <= last; a += 60)
                {
                    source = VerdictAt(a, out predicted);
                    if (source != 0) { firedAt = a; break; }
                }
            }
            else if (_hProbeShown)
            {
                // During a hold (video/call) presence is unknown; only a SHOWN probe produced evidence.
                firedAt = _hProbeAge;
                source = 1;
                predicted = 0.9;
            }
            if (firedAt >= 0)
            {
                double target = firedAt + hp.HorizonSeconds;
                if (lower >= target) HabitModel.AddScore(j, predicted, true, source, hp);
                else if (kind == HabitEvidence.Bounded && upper < target) HabitModel.AddScore(j, predicted, false, source, hp);
            }
            HabitModel.Record(j, e, now, hp);
        }

        // ---------------------------------------------------------------- session events

        /// <summary>The session was locked (by us, by Win+L, or by Windows itself).</summary>
        public void OnSessionLocked(long nowUtcTicks, double idleSeconds, Func<FeatureVector> signature)
        {
            if (_pendingLock != LockCause.None) _p.Stats.LocksConfirmed++;   // the request took effect
            _dimShown = false;
            _confirm = LockCause.None;
            _hold = HoldReason.None;
            HabitSuspend(nowUtcTicks, idleSeconds);
            if (_suspendedByDisconnect)
            {
                // Locked while disconnected: from now on a normal lock, ended by the unlock event.
                _suspendedByDisconnect = false;
                _sessionLocked = true;
                return;
            }
            if (_pendingLock == LockCause.None)
            {
                if (idleSeconds <= _c.ManualLockMaxIdleSeconds)
                {
                    var s = signature();                 // Win+L right after input: gold-standard departure
                    s.IdleSeconds = idleSeconds;
                    _engine.OnManualLock(s, nowUtcTicks);
                    _p.Stats.ObservedDepartures++;
                }
                else if (_engine.EpisodeActive)
                {
                    double t = idleSeconds - _episodeOffset;
                    if (_c.RetrospectiveLearning)
                    {
                        // Windows' own inactivity lock: the unlock time tells whether the user was
                        // there (unlocked within seconds) or not. Decide then.
                        _deferredSig = _engine.CurrentSignature.Clone();
                        _deferredSig.IdleSeconds = t;
                        _deferredFired = _p.Model.LockTime(_deferredSig.X, _p.Config.SoftDimThreshold, t + 1) <= t;
                        _deferredLockTicks = nowUtcTicks;
                        _engine.AbortEpisode();
                    }
                    else if (t >= _p.Config.LongAbsenceSeconds) _engine.OnLongAbsence(nowUtcTicks);   // legacy
                    else _engine.AbortEpisode();
                }
            }
            else if (_engine.EpisodeActive)
            {
                _engine.AbortEpisode();
            }
            _sessionLocked = true;
        }

        /// <summary>The session was unlocked: score our own lock by how quickly that happened.</summary>
        public void OnSessionUnlocked(long nowUtcTicks)
        {
            bool quick = Seconds(nowUtcTicks - _pendingLockTicks) <= _p.Config.FalsePositiveWindowSeconds;
            if (_pendingLock != LockCause.None && !quick) _p.Quality?.RecordExposure(_pendingLockIdle);   // really away: unattended until our lock
            switch (_pendingLock)
            {
                case LockCause.Model: _engine.ApplyEnforcedLockOutcome(nowUtcTicks); break;
                case LockCause.HoldProbe: if (quick) _p.Stats.HoldProbeQuickUnlocks++; break;
                case LockCause.Backstop: if (quick) _p.Stats.BackstopQuickUnlocks++; break;
                case LockCause.Habit: if (quick) _p.Stats.HabitQuickUnlocks++; break;
            }
            if (_pendingLock != LockCause.None && !quick) _p.Stats.ObservedDepartures++;
            // One rule for every cause: a lock is judged by the unlock time. Quick = the user was
            // there (a wrong decision, present label); slow = they were away (observed departure).
            if (_pendingSig != null)
            {
                _engine.LearnRetrospective(_pendingSig, away: !quick, nowUtcTicks);
                _p.Modes.RecordEpisodeOutcome(true, quick);
                if (!quick) _p.Modes.RecordConfirmedPositive();
                _pendingSig = null;
            }
            _lockAttempts = 0;
            _pendingLock = LockCause.None;
            _sessionLocked = false;
            _suspendedByDisconnect = false;
            _inputSinceEpisode = true;
            _episodeOffset = 0.0;
            if (_deferredSig != null)
            {
                bool present = Seconds(nowUtcTicks - _deferredLockTicks) <= _p.Config.FalsePositiveWindowSeconds;
                _engine.LearnRetrospective(_deferredSig, away: !present, nowUtcTicks);
                if (present) _p.Modes.RecordEpisodeOutcome(_deferredFired, _deferredFired);   // a fire would have hit a present user
                else { _p.Modes.RecordEpisodeOutcome(_deferredFired, false); _p.Modes.RecordConfirmedPositive(); _p.Stats.ObservedDepartures++; }
                _deferredSig = null;
            }
            HabitReturnFromUnlock(nowUtcTicks);
        }

        /// <summary>
        /// RDP client closed / network drop / console handed over to RDP. The session is no longer
        /// displayed anywhere, so it is secure; reconnecting requires authentication. NOT a
        /// departure label: closing an RDP window says nothing about leaving the desk.
        /// </summary>
        public void OnSessionDisconnected(long nowUtcTicks, double idleSeconds)
        {
            if (_sessionLocked) return;                  // already locked: the unlock event follows later
            _p.Stats.Disconnects++;
            if (_pendingLock != LockCause.None) _p.Stats.LocksConfirmed++;   // fallback (or RDP close) secured it
            _dimShown = false;
            _confirm = LockCause.None;
            _hold = HoldReason.None;
            if (_engine.EpisodeActive) _engine.AbortEpisode();
            HabitSuspend(nowUtcTicks, idleSeconds);
            _sessionLocked = true;
            _suspendedByDisconnect = true;
        }

        public void OnSessionConnected(long nowUtcTicks)
        {
            if (!_suspendedByDisconnect) return;         // a real lock is still in force
            _suspendedByDisconnect = false;
            _sessionLocked = false;
            _inputSinceEpisode = true;
            _episodeOffset = 0.0;
            // A lock we issued that never took effect before the disconnect: drop its verdict.
            if (_pendingLock == LockCause.Model) _engine.DiscardEnforcedLock();
            _pendingLock = LockCause.None;
            _pendingSig = null;
            _lockAttempts = 0;
            HabitReturnFromUnlock(nowUtcTicks);
        }

        /// <summary>
        /// LockWorkStation() returned false (e.g. DisableLockWorkstation policy). The lock is still
        /// wanted: it is requested again after LockRetrySeconds of continued idle, and after
        /// LockFallbackAfterAttempts requests the fallback (Disconnect) is used. Only input from
        /// the user, a session-lock event or a disconnect ends it.
        /// </summary>
        public void OnLockRefused()
        {
            if (_pendingLock == LockCause.None) return;
            _lastAttemptRefused = true;
            _p.Stats.LockRefusals++;
        }

        /// <summary>The fallback disconnect failed as well (WTSDisconnectSession returned false).</summary>
        public void OnDisconnectRefused() => OnLockRefused();

        public bool OnUserFlaggedUnjustified(long nowUtcTicks) => _engine.OnUserFlaggedUnjustified(nowUtcTicks);
    }
}
