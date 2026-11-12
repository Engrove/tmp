using System;

namespace PresenceLock.Core
{
    public enum DecisionAction
    {
        None,       // keep watching
        SoftDim,    // begin the 3 s warning dim
        TriggerLock // escalate: in Enforcing -> LockWorkStation(); in Learning -> silent / notice only
    }

    public struct DecisionResult
    {
        public DecisionAction Action;
        public double Probability;
        public OperatingMode Mode;
        public double IdleSeconds;
    }

    /// <summary>
    /// Pure decision logic. No OS calls, no timers of its own: the host (the Windows
    /// tray app, the C# unit tests, or the Python reference harness) feeds it wall-clock
    /// ticks and idle time, and supplies ground truth via the On* feedback hooks. This is
    /// what makes the whole brain testable off-Windows.
    ///
    /// Lifecycle per idle episode:
    ///   BeginEpisode(signature) ... UpdateLive/Tick repeatedly ... then exactly one of:
    ///     OnInputResumed()  (user came back)
    ///     OnLongAbsence()   (absence became certain)
    ///     AbortEpisode()    (ended for a reason that carries no label, e.g. OS timeout lock)
    ///   In Enforcing mode a TriggerLock ends the episode itself; its verdict arrives later
    ///   via ApplyEnforcedLockOutcome() when the session is unlocked.
    /// Manual Win+L is reported independently via OnManualLock().
    /// </summary>
    public sealed class PresenceEngine
    {
        private readonly UserProfile _p;
        private readonly PresenceModel _model;
        private readonly ModeController _modes;
        private readonly EngineConfig _cfg;

        // Runtime (not persisted).
        private FeatureVector _episode;      // signature at idle start (+ live idle)
        private bool _episodeActive;
        private bool _softDimActive;
        private long _softDimStartTicks;
        private bool _lockFired;
        private long _lastFiredTicks;        // last soft-dim/lock, for FP windowing
        private bool _firedDecisionPending;  // a dim/lock whose outcome is not yet scored

        // Enforced (real) lock awaiting its unlock-delta verdict.
        private FeatureVector _pendingLockSig;
        private bool _pendingLockActive;
        private long _pendingLockTicks;

        // Learning-mode "would have locked" decision, kept so the user can flag it
        // as unjustified from the "Visa låsning" notice.
        private FeatureVector _lastWouldLockSig;
        private long _lastWouldLockTicks;
        private bool _lastWouldLockAlreadyRejected;

        public PresenceEngine(UserProfile profile)
        {
            _p = profile ?? throw new ArgumentNullException(nameof(profile));
            _model = profile.Model;
            _modes = profile.Modes;
            _cfg = profile.Config;
        }

        public OperatingMode Mode => _modes.Mode;
        public UserProfile Profile => _p;
        public double LastProbability { get; private set; }
        public bool EpisodeActive => _episodeActive;
        public bool EnforcedLockPending => _pendingLockActive;

        /// <summary>The signature of the current idle episode (null if none).</summary>
        public FeatureVector CurrentSignature => _episodeActive ? _episode : null;

        /// <summary>Start tracking a new idle episode from the captured signature.</summary>
        public void BeginEpisode(FeatureVector signature, long nowUtcTicks)
        {
            if (signature == null) throw new ArgumentNullException(nameof(signature));
            _modes.EnsureStarted(nowUtcTicks);

            _episode = signature.Clone();
            _episode.IdleSeconds = 0.0;
            _episodeActive = true;
            _softDimActive = false;
            _lockFired = false;
            _firedDecisionPending = false;

            // Track optional-sensor availability for enforcing-mode masking.
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                if (!FeatureSchema.Optional[i]) continue;
                _p.OptionalSeen[i]++;
                if (signature.Available[i]) _p.OptionalAvailable[i]++;
            }
        }

        /// <summary>Update live idle seconds (and any live optional feature values).</summary>
        public void UpdateLive(double idleSeconds, double[] liveOptional = null)
        {
            if (!_episodeActive) return;
            _episode.IdleSeconds = idleSeconds;
            if (liveOptional != null)
            {
                for (int i = 0; i < FeatureSchema.Count && i < liveOptional.Length; i++)
                    if (FeatureSchema.Optional[i] && _episode.Available[i])
                        _episode.X[i] = liveOptional[i];
            }
        }

        private FeatureVector EvalFeatures()
        {
            // In enforcing mode, strip optional features that were not confirmed reliable.
            return _modes.Mode == OperatingMode.Enforcing
                ? _episode.Masked(_p.ConfirmedOptionalMask())
                : _episode;
        }

        /// <summary>
        /// Advance the decision state machine one step. Does not touch the OS; returns
        /// the action the host should perform.
        /// </summary>
        public DecisionResult Tick(long nowUtcTicks, ModePolicy policy = ModePolicy.Auto)
        {
            _modes.Evaluate(nowUtcTicks, policy);
            var r = new DecisionResult { Action = DecisionAction.None, Mode = _modes.Mode };
            if (!_episodeActive) { r.Probability = LastProbability; return r; }

            var fv = EvalFeatures();
            double p = _model.Probability(fv);
            LastProbability = p;
            r.Probability = p;
            r.IdleSeconds = _episode.IdleSeconds;

            if (!_softDimActive)
            {
                if (p >= _cfg.SoftDimThreshold)
                {
                    _softDimActive = true;
                    _softDimStartTicks = nowUtcTicks;
                    _lastFiredTicks = nowUtcTicks;
                    _firedDecisionPending = true;
                    r.Action = DecisionAction.SoftDim;
                }
            }
            else
            {
                double dimElapsed = (nowUtcTicks - _softDimStartTicks) / (double)TimeSpan.TicksPerSecond;
                if (!_lockFired && dimElapsed >= _cfg.SoftDimSeconds && p >= _cfg.LockThreshold)
                {
                    _lockFired = true;
                    _lastFiredTicks = nowUtcTicks;
                    r.Action = DecisionAction.TriggerLock;

                    if (_modes.Mode == OperatingMode.Enforcing)
                    {
                        // The OS is really locked now, so this episode is resolved here and
                        // judged later by the unlock delta. End it so a later
                        // OnInputResumed cannot double-count it.
                        _pendingLockSig = fv.Clone();
                        _pendingLockActive = true;
                        _pendingLockTicks = nowUtcTicks;
                        EndEpisode();
                    }
                    else
                    {
                        // Learning: nothing is locked. Remember the decision so the user can
                        // flag it from the optional notice.
                        _lastWouldLockSig = fv.Clone();
                        _lastWouldLockTicks = nowUtcTicks;
                        _lastWouldLockAlreadyRejected = false;
                    }
                }
            }
            return r;
        }

        // --- Ground-truth feedback hooks -----------------------------------------

        /// <summary>User produced input again. If we had just fired, that was a false positive.</summary>
        public void OnInputResumed(long nowUtcTicks)
        {
            if (!_episodeActive) return;

            bool fired = _firedDecisionPending;
            bool rejected = false;
            if (fired)
            {
                double sinceFired = (nowUtcTicks - _lastFiredTicks) / (double)TimeSpan.TicksPerSecond;
                rejected = sinceFired <= _cfg.FalsePositiveWindowSeconds;
            }
            if (fired && !rejected && _modes.Mode == OperatingMode.Learning)
                _modes.RecordUnverifiedFire();       // invisible decision, truth unknown
            else
                _modes.RecordEpisodeOutcome(fired, rejected);

            if (rejected)
            {
                var kind = _lockFired ? FeedbackKind.FalsePositive : FeedbackKind.SoftDimRejected;
                Learn(FeedbackSample.From(_episode.Clone(), kind, nowUtcTicks));
                if (_lockFired) _lastWouldLockAlreadyRejected = true; // don't double-learn a later flag
            }
            EndEpisode();
        }

        /// <summary>
        /// Idle passed the certain-absence horizon. This is a CENSORED observation: we know
        /// the user was away at the current idle time, NOT when they left (they may have
        /// read for two minutes and then walked off). So the label is applied at the
        /// observed idle time, never back-dated to t0 — back-dating would teach the model
        /// that "reading" signatures mean "leaving".
        /// </summary>
        public void OnLongAbsence(long nowUtcTicks)
        {
            if (!_episodeActive) return;
            _modes.RecordEpisodeOutcome(_lockFired, false); // never a false positive
            _modes.RecordConfirmedPositive();
            Learn(FeedbackSample.From(_episode.Clone(), FeedbackKind.LongAbsence, nowUtcTicks));
            EndEpisode();
        }

        /// <summary>User pressed Win+L: the pre-lock signature is a gold-standard positive.</summary>
        public void OnManualLock(FeatureVector preLockSignature, long nowUtcTicks)
        {
            if (preLockSignature == null) throw new ArgumentNullException(nameof(preLockSignature));
            _modes.EnsureStarted(nowUtcTicks);
            _modes.RecordEpisodeOutcome(false, false);
            _modes.RecordConfirmedPositive();
            Learn(FeedbackSample.From(preLockSignature.Clone(), FeedbackKind.ManualLock, nowUtcTicks));
            EndEpisode();
        }

        /// <summary>
        /// Resolve a real (enforcing-mode) lock once the session is unlocked again.
        /// The user saw a 3 s dim and did not react, then the lock happened. A quick unlock
        /// therefore means we locked a present user (false positive); a long one confirms
        /// they were away at the decision time and reinforces it.
        /// </summary>
        public void ApplyEnforcedLockOutcome(long nowUtcTicks)
        {
            if (!_pendingLockActive) return;
            double delta = (nowUtcTicks - _pendingLockTicks) / (double)TimeSpan.TicksPerSecond;
            bool rejected = delta <= _cfg.FalsePositiveWindowSeconds;
            _modes.RecordEpisodeOutcome(true, rejected);
            if (rejected)
            {
                Learn(FeedbackSample.From(_pendingLockSig, FeedbackKind.FalsePositive, nowUtcTicks));
            }
            else
            {
                _modes.RecordConfirmedPositive();
                Learn(FeedbackSample.From(_pendingLockSig, FeedbackKind.LongAbsence, nowUtcTicks));
            }
            _pendingLockActive = false;
            _pendingLockSig = null;
        }

        /// <summary>
        /// The user clicked the learning-mode notice ("this lock would have been wrong").
        /// Applies a strong negative example at the decision time. Returns true if applied.
        /// </summary>
        public bool OnUserFlaggedUnjustified(long nowUtcTicks, int maxAgeSeconds = 300)
        {
            if (_lastWouldLockSig == null) return false;
            double age = (nowUtcTicks - _lastWouldLockTicks) / (double)TimeSpan.TicksPerSecond;
            var sig = _lastWouldLockSig;
            bool already = _lastWouldLockAlreadyRejected;
            _lastWouldLockSig = null;
            if (age > maxAgeSeconds || already) return false;

            _modes.RecordUserCorrection();
            Learn(FeedbackSample.From(sig, FeedbackKind.UserFlaggedUnjustified, nowUtcTicks));
            return true;
        }

        /// <summary>End the current episode without producing any training label.</summary>
        public void AbortEpisode() => EndEpisode();

        /// <summary>
        /// The OS refused to lock (e.g. the DisableLockWorkstation policy is set). Drop the
        /// pending verdict, otherwise a later unrelated unlock would be scored as a "correct
        /// lock" and teach the model something that never happened.
        /// </summary>
        public void DiscardEnforcedLock()
        {
            _pendingLockActive = false;
            _pendingLockSig = null;
        }

        /// <summary>Horizon used for the decision-level stability metric.</summary>
        public const double StabilityHorizonSeconds = 600.0;

        private void Learn(FeedbackSample s)
        {
            // Stability is measured on the DECISION, not on raw parameters: how much did the
            // lock time in the corrected situation move, relative to its size? (Raw parameter
            // deltas are dominated by the t-scaling of the hazard gradient and say little
            // about whether behaviour has settled.)
            double[] x = s.Features.X;
            double before = _model.LockTime(x, _cfg.LockThreshold, StabilityHorizonSeconds);
            _model.Update(s);
            double after = _model.LockTime(x, _cfg.LockThreshold, StabilityHorizonSeconds);
            double relative = Math.Abs(after - before) / Math.Max(before, 10.0);
            _modes.RecordUpdateChange(relative);
            _p.UpdatedUtcTicks = DateTime.UtcNow.Ticks;
        }

        private void EndEpisode()
        {
            _episodeActive = false;
            _softDimActive = false;
            _lockFired = false;
            _firedDecisionPending = false;
        }

        public string Diagnostics(long nowUtcTicks) => _modes.Explain(nowUtcTicks);
    }
}
