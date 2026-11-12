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
    }

    public enum HoldReason { None, Media, Meeting }

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
        WouldLockNotice
    }

    public enum LockCause { None, Model, Backstop, HoldProbe }

    public struct CoordinatorResult
    {
        public CoordinatorAction Action;
        public LockCause Cause;
        public HoldReason Hold;
        public OperatingMode Mode;
        public double Probability;
        public double EpisodeSeconds;
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
        /// <summary>How long a confirmation dim (hold probe / backstop) waits before locking.</summary>
        public double ConfirmGraceSeconds = 15.0;
    }

    /// <summary>
    /// The complete decision flow around the learned engine, as pure logic (no OS calls, no
    /// timers) so it is unit-testable and simulatable. The Windows host calls Tick() once per
    /// second with idle time and passive signals and performs the returned action.
    ///
    /// Three layers, in priority order:
    ///  1. INPUT        idle &lt; 1 s: the user is here. Resolve whatever was pending.
    ///  2. PASSIVE HOLD A meeting (mic/camera open by a running process) or visible media
    ///                  (display-required request) explains the stillness. The learned model is
    ///                  paused and the running episode is DISCARDED without a label, because
    ///                  "idle for 180 s" no longer means "away" and would teach the model that
    ///                  watching a video equals leaving.
    ///  3. MODEL        the self-learning engine decides (soft-dim, lock).
    /// plus one absolute rule that overrides all three:
    ///  BACKSTOP        in enforcing mode, when the certain-absence horizon (180 s of episode
    ///                  time) or HoldMaxSeconds of total idle is reached without a lock, a VISIBLE
    ///                  confirmation dim is shown; unanswered within ConfirmGraceSeconds it locks.
    ///                  So no workstation stays unlocked longer than HoldMax + grace after the
    ///                  last input, regardless of signals, model state or bugs in either.
    /// </summary>
    public sealed class PresenceCoordinator
    {
        private readonly PresenceEngine _engine;
        private readonly UserProfile _p;
        private readonly CoordinatorConfig _c;

        private bool _inputSinceEpisode = true;
        private double _episodeOffset;          // idle seconds at which the current episode's clock started
        private HoldReason _hold;
        private bool _dimShown;
        private LockCause _confirm;             // confirmation dim in progress (Backstop / HoldProbe)
        private long _confirmStartTicks;
        private LockCause _pendingLock;         // lock issued, verdict on unlock
        private long _pendingLockTicks;
        private bool _sessionLocked;

        public PresenceCoordinator(PresenceEngine engine, CoordinatorConfig config)
        {
            _engine = engine ?? throw new ArgumentNullException(nameof(engine));
            _p = engine.Profile;
            _c = config ?? new CoordinatorConfig();
        }

        public PresenceEngine Engine => _engine;
        public CoordinatorConfig Config => _c;
        public HoldReason CurrentHold => _hold;
        public LockCause PendingLock => _pendingLock;

        private static double Seconds(long ticks) => ticks / (double)TimeSpan.TicksPerSecond;

        /// <summary>Meeting takes precedence over media. Unavailable signals (null) are no evidence.</summary>
        public HoldReason EvaluateHold(PassiveSignals s)
        {
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
            if (_sessionLocked) return r;
            bool enforcing = _engine.Mode == OperatingMode.Enforcing;

            // ---- 1. input: the user is here ------------------------------------------
            if (idleSeconds < _c.InputResumeIdleSeconds)
            {
                _inputSinceEpisode = true;
                if (_confirm == LockCause.HoldProbe) _p.Stats.HoldProbesAnswered++;
                else if (_confirm == LockCause.Backstop)
                {
                    _p.Stats.BackstopAnswered++;
                    _engine.OnHorizonDimAnswered(nowUtcTicks);   // present at the horizon: y = 0
                }
                _confirm = LockCause.None;
                if (_engine.EpisodeActive) _engine.OnInputResumed(nowUtcTicks);
                _hold = HoldReason.None;
                if (_dimShown) { r.Action = CoordinatorAction.CancelDim; _dimShown = false; }
                return Finish(r, nowUtcTicks, policy, ticked: false);
            }

            // ---- confirmation dim in progress: lock when the grace period runs out ------
            if (_confirm != LockCause.None)
            {
                if (Seconds(nowUtcTicks - _confirmStartTicks) >= _c.ConfirmGraceSeconds)
                {
                    var cause = _confirm;
                    _confirm = LockCause.None;
                    if (cause == LockCause.Backstop)
                    {
                        _p.Stats.BackstopLocks++;
                        if (_engine.EpisodeActive) _engine.OnLongAbsence(nowUtcTicks); // verified absence
                    }
                    else _p.Stats.HoldProbeLocks++;
                    IssueLock(ref r, cause, nowUtcTicks);
                }
                r.Hold = _hold;
                return Finish(r, nowUtcTicks, policy, ticked: false);
            }

            // ---- 2. passive hold --------------------------------------------------------
            var hold = EvaluateHold(signals);
            if (hold != HoldReason.None && idleSeconds >= _c.EpisodeStartIdleSeconds)
            {
                if (_engine.EpisodeActive)
                {
                    _engine.AbortEpisode();                // confounded episode: no label at all
                    _p.Stats.HoldAbortedEpisodes++;
                }
                if (_hold == HoldReason.None) _p.Stats.HoldStarts++;
                _hold = hold;
                r.Hold = hold;
                if (_dimShown) { r.Action = CoordinatorAction.CancelDim; _dimShown = false; }

                if (enforcing && idleSeconds >= _c.HoldMaxSeconds)
                    StartConfirm(ref r, LockCause.HoldProbe, nowUtcTicks);
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
                _inputSinceEpisode = false;
            }

            // ---- ordinary episode start ------------------------------------------------
            if (!_engine.EpisodeActive && _inputSinceEpisode && idleSeconds >= _c.EpisodeStartIdleSeconds)
            {
                _engine.BeginEpisode(signature(), nowUtcTicks);
                _episodeOffset = 0.0;
                _inputSinceEpisode = false;
            }

            // ---- 3. the learned model ---------------------------------------------------
            bool ticked = false;
            if (_engine.EpisodeActive)
            {
                double t = idleSeconds - _episodeOffset;
                r.EpisodeSeconds = t;
                _engine.UpdateLive(t);

                bool horizon = t >= _p.Config.LongAbsenceSeconds || idleSeconds >= _c.HoldMaxSeconds;
                if (horizon)
                {
                    if (enforcing)
                    {
                        _p.Stats.BackstopDims++;
                        StartConfirm(ref r, LockCause.Backstop, nowUtcTicks);  // verify, then lock
                    }
                    else _engine.OnLongAbsence(nowUtcTicks);                   // learning: censored label
                }
                else
                {
                    var d = _engine.Tick(nowUtcTicks, policy);
                    ticked = true;
                    r.Probability = d.Probability;
                    if (d.Action == DecisionAction.SoftDim && d.Mode == OperatingMode.Enforcing)
                    {
                        r.Action = CoordinatorAction.SoftDim;
                        r.Cause = LockCause.Model;
                        _dimShown = true;
                    }
                    else if (d.Action == DecisionAction.TriggerLock)
                    {
                        if (d.Mode == OperatingMode.Enforcing) IssueLock(ref r, LockCause.Model, nowUtcTicks);
                        else r.Action = CoordinatorAction.WouldLockNotice;
                    }
                }
            }
            return Finish(r, nowUtcTicks, policy, ticked);
        }

        private void StartConfirm(ref CoordinatorResult r, LockCause cause, long now)
        {
            _confirm = cause;
            _confirmStartTicks = now;
            if (cause == LockCause.HoldProbe) _p.Stats.HoldProbes++;
            r.Action = CoordinatorAction.SoftDim;
            r.Cause = cause;
            _dimShown = true;
        }

        private void IssueLock(ref CoordinatorResult r, LockCause cause, long now)
        {
            r.Action = CoordinatorAction.Lock;
            r.Cause = cause;
            _pendingLock = cause;
            _pendingLockTicks = now;
            _dimShown = false;
        }

        private CoordinatorResult Finish(CoordinatorResult r, long now, ModePolicy policy, bool ticked)
        {
            // Keep the promotion gate evaluated even when no episode is being decided.
            // Never tick an active episode here: that would run its state machine twice.
            if (!ticked && !_engine.EpisodeActive) _engine.Tick(now, policy);
            r.Mode = _engine.Mode;
            return r;
        }

        /// <summary>Kinematics are minutes old after a hold: zero them and flag the episode.</summary>
        public static void MarkPostHold(FeatureVector f)
        {
            foreach (int i in FeatureSchema.Kinematic) f.X[i] = 0.0;
            f.X[FeatureSchema.PostHold] = 1.0;
        }

        // ---------------------------------------------------------------- session events

        /// <summary>The session was locked (by us, by Win+L, or by Windows itself).</summary>
        public void OnSessionLocked(long nowUtcTicks, double idleSeconds, Func<FeatureVector> signature)
        {
            _dimShown = false;
            _confirm = LockCause.None;
            _hold = HoldReason.None;
            if (_pendingLock == LockCause.None)
            {
                if (idleSeconds <= _c.ManualLockMaxIdleSeconds)
                {
                    var s = signature();                 // Win+L right after input: gold-standard departure
                    s.IdleSeconds = idleSeconds;
                    _engine.OnManualLock(s, nowUtcTicks);
                }
                else if (_engine.EpisodeActive)
                {
                    // Windows' own inactivity lock or a remote lock: only certain if past the horizon.
                    if (idleSeconds - _episodeOffset >= _p.Config.LongAbsenceSeconds) _engine.OnLongAbsence(nowUtcTicks);
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
            switch (_pendingLock)
            {
                case LockCause.Model: _engine.ApplyEnforcedLockOutcome(nowUtcTicks); break;
                case LockCause.HoldProbe: if (quick) _p.Stats.HoldProbeQuickUnlocks++; break;
                case LockCause.Backstop: if (quick) _p.Stats.BackstopQuickUnlocks++; break;
            }
            _pendingLock = LockCause.None;
            _sessionLocked = false;
            _inputSinceEpisode = true;
            _episodeOffset = 0.0;
        }

        /// <summary>LockWorkStation() failed (e.g. DisableLockWorkstation policy).</summary>
        public void OnLockRefused()
        {
            if (_pendingLock == LockCause.Model) _engine.DiscardEnforcedLock();
            _pendingLock = LockCause.None;
        }

        public bool OnUserFlaggedUnjustified(long nowUtcTicks) => _engine.OnUserFlaggedUnjustified(nowUtcTicks);
    }
}
