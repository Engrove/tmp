"""
presence_reference.py
=====================
A faithful, line-for-line port of PresenceLock.Core's math into Python, used ONLY
to verify the algorithm on this (non-Windows) machine. The shipping implementation
is the C# in src/PresenceLock.Core; this file must mirror its formulas exactly so
that a green run here is real evidence about the code that ships.

Mirrored from:
  MathUtil.cs, PresenceModel.cs, ModeController.cs, PresenceEngine.cs, FeatureSchema.cs
"""
import math

# ----- FeatureSchema.cs ------------------------------------------------------
SCROLL_FRAC, DECELERATION, ABRUPT_STOP, EDGE_FLING, MICRO_JERK = 0, 1, 2, 3, 4
CTX_READING, CTX_LEAVING, TIME_DEPART = 5, 6, 7
AUDIO_PRESENT, AUDIO_DOPPLER_AWAY, BLE_RSSI_DROP = 8, 9, 10
POST_HOLD = 11          # schema v2
REMOTE_SESSION = 12     # schema v3
N = 13
OPTIONAL = [False]*8 + [True, True, True] + [False, False]


# ----- MathUtil.cs -----------------------------------------------------------
def sigmoid(x):
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)

def log1p_compat(x):
    """Mirror of MathCompat.Log1p in MathUtil.cs (same algorithm => bit parity)."""
    if x <= -1.0:
        return float("-inf")
    u = 1.0 + x
    if u == 1.0:
        return x
    return math.log(u) * (x / (u - 1.0))

def softplus(x):
    if x > 30.0:
        return x
    if x < -30.0:
        return math.exp(x)
    return log1p_compat(math.exp(x))

def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v

def clip_abs(v, lim):
    return lim if v > lim else -lim if v < -lim else v


# ----- PresenceModel.cs ------------------------------------------------------
DEFAULT_W0 = -3.0
DEFAULT_U0 = -2.15173   # softplus^-1(0.11): neutral baseline == the user's own sim

class PresenceModel:
    def __init__(self):
        self.W0 = DEFAULT_W0
        self.U0 = DEFAULT_U0
        self.W = [0.0]*N
        self.U = [0.0]*N
        self.lr = 0.05
        self.l2 = 1e-4
        self.grad_clip = 5.0
        self.rate_clip = 6.0

    # NOTE: accumulation is sequential (acc = bias; acc += w_i*x_i) in exactly the
    # order PresenceModel.cs uses, so results are bit-identical, not merely close.
    def _dot(self, bias, w, x):
        acc = bias
        for i in range(N):
            acc += w[i] * x[i]
        return acc

    def hazard(self, x):
        a = self._dot(self.U0, self.U, x)
        a = clamp(a, -self.rate_clip, self.rate_clip)
        return softplus(a)

    def probability(self, x, idle):
        z = self._dot(self.W0, self.W, x)
        z += self.hazard(x) * idle
        return sigmoid(z)

    def forward(self, x, t):
        a = self._dot(self.U0, self.U, x)
        a = clamp(a, -self.rate_clip, self.rate_clip)
        lam = softplus(a)
        z = self._dot(self.W0, self.W, x)
        z += lam * t
        return sigmoid(z), lam, sigmoid(a)

    def update(self, x, t, y, weight):
        """One SGD step. Returns L1 magnitude of the parameter change."""
        p, lam, sig_a = self.forward(x, t)
        err = (p - y) * weight
        lr = self.lr
        change = 0.0

        g_w0 = clip_abs(err, self.grad_clip)             # bias: no L2
        d = lr * g_w0; self.W0 -= d; change += abs(d)

        t_sig = t * sig_a
        g_u0 = clip_abs(err * t_sig, self.grad_clip)      # bias: no L2
        d = lr * g_u0; self.U0 -= d; change += abs(d)

        for i in range(N):
            xi = x[i]
            g_wi = clip_abs(err * xi, self.grad_clip) + self.l2 * self.W[i]
            d = lr * g_wi; self.W[i] -= d; change += abs(d)

            g_ui = clip_abs(err * t_sig * xi, self.grad_clip) + self.l2 * self.U[i]
            d = lr * g_ui; self.U[i] -= d; change += abs(d)

        return change

    def raw_gradient(self, x, t, y):
        """Analytic gradient of log-loss wrt all params (no clip, no L2, weight=1).
        Used only for the finite-difference check."""
        p, lam, sig_a = self.forward(x, t)
        err = p - y
        t_sig = t * sig_a
        g = {"W0": err, "U0": err * t_sig, "W": [err*x[i] for i in range(N)],
             "U": [err*t_sig*x[i] for i in range(N)]}
        return g

    def logloss(self, x, t, y):
        p, _, _ = self.forward(x, t)
        p = min(max(p, 1e-12), 1 - 1e-12)
        return -(y*math.log(p) + (1-y)*math.log(1-p))

    def lock_time(self, x, target, t_max=600.0):
        """Mirror of PresenceModel.LockTime (capped bisection, 50 iterations)."""
        if self.probability(x, 0.0) >= target:
            return 0.0
        if self.probability(x, t_max) < target:
            return t_max
        lo, hi = 0.0, t_max
        for _ in range(50):
            mid = 0.5 * (lo + hi)
            if self.probability(x, mid) >= target:
                hi = mid
            else:
                lo = mid
        return hi

    def time_to_prob(self, x, target, t_max=600.0):
        """Smallest idle time at which probability reaches `target` (or +inf)."""
        lo, hi = 0.0, t_max
        if self.probability(x, hi) < target:
            return float("inf")
        for _ in range(60):
            mid = 0.5*(lo+hi)
            if self.probability(x, mid) >= target:
                hi = mid
            else:
                lo = mid
        return hi


# ----- ModeController.cs -----------------------------------------------------
TICKS_PER_DAY = 864_000_000_000  # TimeSpan.TicksPerDay

class ModeController:
    """Mirror of ModeController.cs: windowed outcomes + Wilson 95% upper-bound gate."""
    LEARNING, ENFORCING = "Learning", "Enforcing"
    AUTO, FORCE_LEARNING, FORCE_ENFORCING = "Auto", "ForceLearning", "ForceEnforcing"
    WINDOW = 200
    Z95 = 1.959964

    def __init__(self):
        self.min_days = 15
        self.max_days = 30
        self.target_fp = 0.10
        self.min_positives = 30
        self.mode = self.LEARNING
        self.learning_extended = False
        self.first_seen = 0
        self.positives = 0
        self.fired = 0
        self.rejected = 0
        self.window = [False] * self.WINDOW
        self.head = 0
        self.count = 0
        self.promoted_at = 0
        self.promotion_rate = 0.0
        self.promotion_ub = 0.0
        self.promotion_forced = False
        self.fp_ema = 0.0          # diagnostic only
        self.stab_ema = 1.0        # diagnostic only
        self._fp_alpha = 0.08
        self._stab_alpha = 0.05

    def ensure_started(self, now):
        if self.first_seen == 0:
            self.first_seen = now

    def days_elapsed(self, now):
        if self.first_seen == 0:
            return 0.0
        return (now - self.first_seen) / TICKS_PER_DAY

    def _push(self, fp):
        self.window[self.head] = fp
        self.head = (self.head + 1) % self.WINDOW
        if self.count < self.WINDOW:
            self.count += 1
        self.fp_ema = (1-self._fp_alpha)*self.fp_ema + self._fp_alpha*(1.0 if fp else 0.0)

    def record_episode_outcome(self, fired, rejected):
        if fired:
            self.fired += 1
        if rejected:
            self.rejected += 1
        self._push(fired and rejected)

    def record_unverified_fire(self):
        self.fired += 1
        self._push(True)

    def record_positive(self):
        self.positives += 1

    def record_user_correction(self):
        self.rejected += 1
        if self.count > 0:
            self.window[(self.head - 1) % self.WINDOW] = True
        self.fp_ema = min(1.0, self.fp_ema + self._fp_alpha)

    def record_update(self, change):
        self.stab_ema = (1-self._stab_alpha)*self.stab_ema + self._stab_alpha*change

    def window_fp(self):
        return sum(1 for i in range(self.count)
                   if self.window[(self.head - 1 - i) % self.WINDOW])

    def window_rate(self):
        return 1.0 if self.count == 0 else self.window_fp() / self.count

    def fp_upper_bound(self):
        if self.count == 0:
            return 1.0
        n = float(self.count)
        p = self.window_fp() / n
        z2 = self.Z95 * self.Z95
        denom = 1.0 + z2 / n
        center = p + z2 / (2.0 * n)
        margin = self.Z95 * math.sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n))
        return min(1.0, (center + margin) / denom)

    def _snapshot(self, now, forced):
        self.promoted_at = now
        self.promotion_rate = self.window_rate()
        self.promotion_ub = self.fp_upper_bound()
        self.promotion_forced = forced

    def evaluate(self, now, policy=AUTO):
        prev = self.mode
        if policy == self.FORCE_LEARNING:
            self.mode = self.LEARNING; return self.mode != prev
        if policy == self.FORCE_ENFORCING:
            self.mode = self.ENFORCING
            if prev != self.mode:
                self._snapshot(now, True)
            return self.mode != prev
        if self.mode == self.ENFORCING:
            return False
        days = self.days_elapsed(now)
        min_time = days >= self.min_days
        enough = self.positives >= self.min_positives
        full = self.count >= self.WINDOW
        fp_safe = full and self.fp_upper_bound() <= self.target_fp
        if min_time and enough and fp_safe:
            self.mode = self.ENFORCING
            self.learning_extended = False
            self._snapshot(now, False)
        else:
            self.learning_extended = days >= self.max_days
        return self.mode != prev


# ----- PresenceEngine.cs (decision state machine + feedback) -----------------
TICKS_PER_SECOND = 10_000_000

class EngineConfig:
    def __init__(self):
        self.soft_dim_threshold = 0.75
        self.lock_threshold = 0.90
        self.soft_dim_seconds = 3
        self.fp_window_seconds = 10
        self.long_absence_seconds = 180

# FeedbackSample.From(kind) -> (y, weight)
KIND = {
    "ManualLock": (1.0, 2.0),
    "LongAbsence": (1.0, 1.5),
    "FalsePositive": (0.0, 1.0),
    "SoftDimRejected": (0.0, 1.0),
    "UserFlaggedUnjustified": (0.0, 2.0),
}

class PresenceEngine:
    NONE, SOFT_DIM, TRIGGER_LOCK = "None", "SoftDim", "TriggerLock"

    def __init__(self, model=None, modes=None, cfg=None):
        self.model = model or PresenceModel()
        self.modes = modes or ModeController()
        self.cfg = cfg or EngineConfig()
        self._ep = None
        self._idle = 0.0
        self._active = False
        self._dim_active = False
        self._dim_start = 0
        self._lock_fired = False
        self._last_fired = 0
        self._pending = False
        self.last_p = 0.0
        self._pending_lock_sig = None
        self._pending_lock_active = False
        self._pending_lock_t = 0
        self._would_sig = None
        self._would_t = 0
        self._would_already_rejected = False

    def begin_episode(self, signature_x, now):
        self.modes.ensure_started(now)
        self._ep = list(signature_x)
        self._idle = 0.0
        self._active = True
        self._dim_active = False
        self._lock_fired = False
        self._pending = False

    def update_live(self, idle):
        if self._active:
            self._idle = idle

    def tick(self, now, policy=ModeController.AUTO):
        self.modes.evaluate(now, policy)
        action, p = self.NONE, self.last_p
        if not self._active:
            return action, p
        p = self.model.probability(self._ep, self._idle)
        self.last_p = p
        if not self._dim_active:
            if p >= self.cfg.soft_dim_threshold:
                self._dim_active = True
                self._dim_start = now
                self._last_fired = now
                self._pending = True
                action = self.SOFT_DIM
        else:
            dim_elapsed = (now - self._dim_start) / TICKS_PER_SECOND
            if (not self._lock_fired and dim_elapsed >= self.cfg.soft_dim_seconds
                    and p >= self.cfg.lock_threshold):
                self._lock_fired = True
                self._last_fired = now
                action = self.TRIGGER_LOCK
                if self.modes.mode == ModeController.ENFORCING:
                    self._pending_lock_sig = (list(self._ep), self._idle)
                    self._pending_lock_active = True
                    self._pending_lock_t = now
                    self._end()
                else:
                    self._would_sig = (list(self._ep), self._idle)
                    self._would_t = now
                    self._would_already_rejected = False
        return action, p

    def on_input_resumed(self, now):
        if not self._active:
            return
        fired = self._pending
        rejected = False
        if fired:
            since = (now - self._last_fired) / TICKS_PER_SECOND
            rejected = since <= self.cfg.fp_window_seconds
        if fired and not rejected and self.modes.mode == ModeController.LEARNING:
            self.modes.record_unverified_fire()   # invisible decision, truth unknown
        else:
            self.modes.record_episode_outcome(fired, rejected)
        if rejected:
            kind = "FalsePositive" if self._lock_fired else "SoftDimRejected"
            self._learn(self._ep, self._idle, kind)
            if self._lock_fired:
                self._would_already_rejected = True
        self._end()

    def on_long_absence(self, now):
        """Censored label at the OBSERVED idle time, never back-dated to t0."""
        if not self._active:
            return
        self.modes.record_episode_outcome(self._lock_fired, False)
        self.modes.record_positive()
        self._learn(self._ep, self._idle, "LongAbsence")
        self._end()

    def on_manual_lock(self, signature_x, idle, now):
        self.modes.ensure_started(now)
        self.modes.record_episode_outcome(False, False)
        self.modes.record_positive()
        self._learn(list(signature_x), idle, "ManualLock")
        self._end()

    def apply_enforced_lock_outcome(self, now):
        if not self._pending_lock_active:
            return
        delta = (now - self._pending_lock_t) / TICKS_PER_SECOND
        rejected = delta <= self.cfg.fp_window_seconds
        self.modes.record_episode_outcome(True, rejected)
        x, idle = self._pending_lock_sig
        if rejected:
            self._learn(x, idle, "FalsePositive")
        else:
            self.modes.record_positive()
            self._learn(x, idle, "LongAbsence")
        self._pending_lock_active = False
        self._pending_lock_sig = None

    def on_user_flagged_unjustified(self, now, max_age_seconds=300):
        if self._would_sig is None:
            return False
        age = (now - self._would_t) / TICKS_PER_SECOND
        sig, already = self._would_sig, self._would_already_rejected
        self._would_sig = None
        if age > max_age_seconds or already:
            return False
        self.modes.record_user_correction()
        x, idle = sig
        self._learn(x, idle, "UserFlaggedUnjustified")
        return True

    def abort_episode(self):
        self._end()

    STABILITY_HORIZON = 600.0

    def _learn(self, x, t, kind):
        y, w = KIND[kind]
        before = self.model.lock_time(x, self.cfg.lock_threshold, self.STABILITY_HORIZON)
        self.model.update(x, t, y, w)
        after = self.model.lock_time(x, self.cfg.lock_threshold, self.STABILITY_HORIZON)
        self.modes.record_update(abs(after - before) / max(before, 10.0))

    def _end(self):
        self._active = False
        self._dim_active = False
        self._lock_fired = False
        self._pending = False


def zeros():
    return [0.0]*N
