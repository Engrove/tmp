"""
user_sim.py
===========
Deterministic synthetic user for end-to-end checks. Uses a 31-bit LCG (integer-only,
identical in Python and C#) so the C# test project can replay the exact same day-by-day
scenario and compare the resulting model parameters number-for-number.

Behaviour per simulated work day (order shuffled deterministically):
  * 10 x "read"            present and silent for 15..100 s, then touches the mouse
  * 2  x "read_then_leave" silent reading for 10..60 s, then walks away 5..15 min
  * 3  x "leave"           abrupt departure signature, away 5..15 min
  * 2  x "manual"          presses Win+L, away 5..15 min
  * 1  x "leave_like_present" leaving-like kinematics but stays 5..30 s (ambiguous on purpose)
  * between them, active work in which the user pauses SHORTLY again and again: 5..60 s of
    input, then 2..29 s without (field distribution, measured on a real profile 2026-11-13:
    362 idle episodes in ~4-5 h of use, at least 85 % of them under 30 s). Every such pause is
    an idle episode for the engine. Up to 0.7.0 the simulation had none, and the gate was
    validated on a distribution that real users do not have.

Visibility rules (this is what makes it honest):
  * Learning mode: nothing the engine decides is visible, so a present user never
    reacts to it. Labels come only from timing, Win+L and certain absence.
  * Enforcing mode: the soft-dim IS visible; a present user nudges the mouse 1 s
    later. An absent user cannot react, so the dim escalates to a real lock.
"""
from presence_reference import (
    PresenceEngine, ModeController, zeros, TICKS_PER_SECOND, TICKS_PER_DAY,
    CTX_READING, SCROLL_FRAC, DECELERATION, ABRUPT_STOP, EDGE_FLING, CTX_LEAVING,
    MICRO_JERK,
)

SEC = TICKS_PER_SECOND
BASE_TICKS = 638_000_000_000_000_000  # a realistic DateTime.UtcNow.Ticks value
LONG_ABSENCE = 180


class Lcg:
    """31-bit LCG; C# mirror: s = (s * 1103515245 + 12345) & 0x7FFFFFFF."""
    def __init__(self, seed):
        self.s = seed & 0x7FFFFFFF

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s

    def uniform_int(self, lo, hi):
        return lo + self.next() % (hi - lo + 1)


def reading_sig():
    x = zeros()
    x[CTX_READING] = 1.0
    x[SCROLL_FRAC] = 0.6
    x[DECELERATION] = 0.8
    return x


def leaving_sig():
    x = zeros()
    x[ABRUPT_STOP] = 1.0
    x[EDGE_FLING] = 1.0
    x[CTX_LEAVING] = 1.0
    x[MICRO_JERK] = 1.0
    return x


OPPORTUNITY = ModeController.OPPORTUNITY_SECONDS


def work_sig():
    """Neutral context mid-work (e.g. the drawing area, a browser): no cue either way."""
    return zeros()


def new_stats():
    return {"episodes": 0, "present_episodes": 0, "dims_on_present": 0,
            "locks_on_present": 0, "departures": 0, "locked_departures": 0,
            "missed_departures": 0, "latencies": [],
            # decision opportunities: the gate's denominator (fired, or idle >= 30 s, or a departure)
            "opportunities": 0, "present_opportunities": 0,
            "short_pauses": 0, "short_dims": 0}


def _count(st, departing, fired, idle, short):
    if departing or fired or idle >= OPPORTUNITY:
        st["opportunities"] += 1
        if not departing:
            st["present_opportunities"] += 1
    if short:
        st["short_pauses"] += 1
        if fired:
            st["short_dims"] += 1


def _episode(eng, now, sig, present_for, away_for, stats, short=False):
    """present_for: seconds the user stays (silently) at the desk.
    away_for: None for a user who simply resumes; else seconds away after leaving.
    short: a pause in the rhythm of active work (statistics only)."""
    departing = away_for is not None
    enforcing = eng.modes.mode == ModeController.ENFORCING
    st = stats["enforcing" if enforcing else "learning"]
    st["episodes"] += 1
    if departing:
        st["departures"] += 1
    else:
        st["present_episodes"] += 1

    eng.begin_episode(sig, now)
    idle = 0
    while True:
        idle += 1
        now += SEC
        eng.update_live(float(idle))
        action, _ = eng.tick(now)
        mode_now = eng.modes.mode
        present = idle <= present_for

        if mode_now == ModeController.ENFORCING:
            if action == PresenceEngine.SOFT_DIM and present:
                st["dims_on_present"] += 1
                _count(st, departing, True, idle, short)
                now += SEC                       # visible dim -> 1 mm nudge
                eng.on_input_resumed(now)
                return now
            if action == PresenceEngine.TRIGGER_LOCK:
                if present:
                    st["locks_on_present"] += 1
                    unlock = now + 5 * SEC
                else:
                    st["locked_departures"] += 1
                    st["latencies"].append(idle - present_for)
                    unlock = now + max(1, present_for + away_for - idle) * SEC
                _count(st, departing, True, idle, short)
                eng.apply_enforced_lock_outcome(unlock)
                return unlock

        if not departing and idle >= present_for:
            _count(st, departing, False, idle, short)
            eng.on_input_resumed(now)           # present user touches the mouse
            return now
        if departing and idle >= LONG_ABSENCE:
            if mode_now == ModeController.ENFORCING:
                st["missed_departures"] += 1
            _count(st, departing, False, idle, short)
            eng.on_long_absence(now)
            return now + max(0, present_for + away_for - idle) * SEC


def _active_work(eng, now, seconds, rng, stats):
    """Active work for 'seconds', with the short pauses real users make (see module doc)."""
    end = now + seconds * SEC
    while True:
        now += rng.uniform_int(5, 60) * SEC
        if now >= end:
            return end
        sig = reading_sig() if rng.next() % 2 == 0 else work_sig()
        now = _episode(eng, now, sig, rng.uniform_int(2, 29), None, stats, short=True)


def run(days=30, seed=12345, engine=None, ambiguous=True, short_pauses=True):
    """ambiguous=False: a cleanly separable user (no present-with-leaving-signature pauses).
    ambiguous=True:  adds one deliberately indistinguishable present pause per day.
    short_pauses=False: the pre-0.7.1 user without typing-rhythm pauses (comparison only)."""
    eng = engine or PresenceEngine()
    rng = Lcg(seed)
    stats = {"learning": new_stats(), "enforcing": new_stats(),
             "gate_at_promotion": None}
    promoted_day = None

    for day in range(days):
        now = BASE_TICKS + day * TICKS_PER_DAY + 8 * 3600 * SEC
        kinds = ["read"] * 10 + ["read_then_leave"] * 2 + ["leave"] * 3 + ["manual"] * 2
        if ambiguous:
            kinds = kinds + ["leave_like_present"]
        for i in range(len(kinds) - 1, 0, -1):          # Fisher-Yates, deterministic
            j = rng.next() % (i + 1)
            kinds[i], kinds[j] = kinds[j], kinds[i]

        for kind in kinds:
            if kind == "manual":
                # counts as a resolved episode in the gate window too (outcome 0)
                mode_key = "enforcing" if eng.modes.mode == ModeController.ENFORCING else "learning"
                stats[mode_key]["episodes"] += 1
                now += 2 * SEC
                eng.on_manual_lock(leaving_sig(), 1.0, now)
                now += rng.uniform_int(300, 900) * SEC
            elif kind == "read":
                now = _episode(eng, now, reading_sig(), rng.uniform_int(15, 100), None, stats)
            elif kind == "read_then_leave":
                d = rng.uniform_int(10, 60)
                now = _episode(eng, now, reading_sig(), d, rng.uniform_int(300, 900), stats)
            elif kind == "leave_like_present":
                # flings the mouse to the edge, then sits and thinks: NOT separable by kinematics
                now = _episode(eng, now, leaving_sig(), rng.uniform_int(5, 30), None, stats)
            else:  # leave
                now = _episode(eng, now, leaving_sig(), 0, rng.uniform_int(300, 900), stats)
            gap = rng.uniform_int(30, 600)               # active work between pauses
            now = _active_work(eng, now, gap, rng, stats) if short_pauses else now + gap * SEC

        # one Tick with no active episode so mode evaluation also happens off-episode
        eng.tick(now)
        if promoted_day is None and eng.modes.mode == ModeController.ENFORCING:
            promoted_day = day
            m = eng.modes
            stats["gate_at_promotion"] = {"rate": m.promotion_rate, "upper95": m.promotion_ub}

    return eng, stats, promoted_day


def enforcing_fire_rate(stats):
    """Realised rate of firing on a present user per DECISION OPPORTUNITY in enforcing mode
    (the same quantity the gate estimates during learning)."""
    E = stats["enforcing"]
    return (E["dims_on_present"] + E["locks_on_present"]) / max(1, E["opportunities"])
