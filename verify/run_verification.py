#!/usr/bin/env python3
"""
run_verification.py
===================
Executable proof for the PresenceLock engine. Every claim is checked with an assertion
and printed with the actual numbers. This runs the SAME math the C# Core ships (see
presence_reference.py; the C# test project replays the same scenarios against the real
C# code and compares numerically). Run:  python3 verify/run_verification.py
"""
import os
import random
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from presence_reference import (
    PresenceModel, ModeController, PresenceEngine,
    zeros, N, CTX_READING, SCROLL_FRAC, DECELERATION, TICKS_PER_DAY, TICKS_PER_SECOND,
)
import user_sim
from user_sim import reading_sig, leaving_sig

random.seed(1)
SEC = TICKS_PER_SECOND
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))


def section(title):
    print("\n" + "=" * 76 + f"\n{title}\n" + "=" * 76)


# --- 1 ----------------------------------------------------------------------------
section("1. Neutral baseline reproduces the reference simulation (37.3 s / 47.2 s)")
m = PresenceModel()
x0 = zeros()
lam, t75, t90 = m.hazard(x0), m.time_to_prob(x0, 0.75), m.time_to_prob(x0, 0.90)
print(f"  lambda={lam:.5f}  t(75%)={t75:.2f} s  t(90%)={t90:.2f} s")
check("lambda == 0.110", abs(lam - 0.110) < 1e-3, f"{lam:.5f}")
check("t(75%) == 37.3 s", abs(t75 - 37.3) < 0.4, f"{t75:.2f}")
check("t(90%) == 47.2 s", abs(t90 - 47.2) < 0.4, f"{t90:.2f}")

# --- 2 ----------------------------------------------------------------------------
section("2. Derived SGD gradients match numeric differentiation (log-loss)")
m = PresenceModel()
m.W0 = random.uniform(-1, 1); m.U0 = random.uniform(-2, 0)
for i in range(N):
    m.W[i] = random.uniform(-0.5, 0.5); m.U[i] = random.uniform(-0.3, 0.3)
x = [random.uniform(-1, 1) for _ in range(N)]
t, y = random.uniform(5, 60), 1.0
g = m.raw_gradient(x, t, y)
eps, max_err = 1e-6, 0.0


def loss_with(attr, idx, delta):
    if idx is None:
        o = getattr(m, attr); setattr(m, attr, o + delta)
        v = m.logloss(x, t, y); setattr(m, attr, o)
    else:
        a = getattr(m, attr); o = a[idx]; a[idx] = o + delta
        v = m.logloss(x, t, y); a[idx] = o
    return v


params = [("W0", None, g["W0"]), ("U0", None, g["U0"])] + \
         [("W", i, g["W"][i]) for i in range(N)] + [("U", i, g["U"][i]) for i in range(N)]
for attr, idx, analytic in params:
    num = (loss_with(attr, idx, eps) - loss_with(attr, idx, -eps)) / (2 * eps)
    max_err = max(max_err, abs(num - analytic))
print(f"  max |analytic - numeric| over {len(params)} parameters = {max_err:.2e}")
check("gradients correct to 1e-6", max_err < 1e-6, f"{max_err:.2e}")

# --- 3 ----------------------------------------------------------------------------
section("3. False positives make the model wait LONGER in the same context")
m = PresenceModel()
ctx = reading_sig()
before = m.time_to_prob(ctx, 0.90)
for _ in range(40):
    m.update(ctx, 48.0, y=0.0, weight=1.0)
after = m.time_to_prob(ctx, 0.90)
print(f"  reading context t(90%): {before:.1f} s -> {after:.1f} s after 40 FPs")
check("backs off by >= 30 s", after - before >= 30.0, f"+{after - before:.1f} s")

# --- 4 ----------------------------------------------------------------------------
section("4. Confirmed departures make the model lock SOONER in a leaving context")
m = PresenceModel()
lv = leaving_sig()
before = m.time_to_prob(lv, 0.90)
for _ in range(40):
    m.update(lv, 1.0, y=1.0, weight=2.0)          # manual Win+L at ~1 s idle
after = m.time_to_prob(lv, 0.90)
print(f"  leaving signature t(90%): {before:.1f} s -> {after:.1f} s after 40 manual locks")
check("locks >= 15 s sooner", before - after >= 15.0, f"-{before - after:.1f} s")

# --- 5 ----------------------------------------------------------------------------
section("5a. End-to-end, separable user: 60 simulated work days")
eng, st, promoted = user_sim.run(days=60, seed=12345, ambiguous=False)
t_read = eng.model.time_to_prob(reading_sig(), 0.90)
t_leave = eng.model.time_to_prob(leaving_sig(), 0.90)
E = st["enforcing"]
print(f"  promoted to Enforcing on day: {promoted}   gate at promotion: {st['gate_at_promotion']}")
print(f"  final t(90%): reading context {t_read:.1f} s, leaving signature {t_leave:.1f} s")
print(f"  ENFORCING phase ({E['episodes']} episodes):")
print(f"    present-user pauses {E['present_episodes']:4d}   dims shown {E['dims_on_present']:3d}"
      f"   HARD LOCKS on present user {E['locks_on_present']}")
print(f"    departures          {E['departures']:4d}   locked {E['locked_departures']:3d}"
      f"   missed (reached 180 s) {E['missed_departures']}")
if E["latencies"]:
    print(f"    lock latency after leaving: median {statistics.median(E['latencies']):.0f} s, "
          f"max {max(E['latencies'])} s")
check("promoted within 15..30 days", promoted is not None and 15 <= promoted < 30, f"day {promoted}")
check("leaving signature locks fast (t90 < 30 s)", t_leave < 30.0, f"{t_leave:.1f} s")
check("reading waits >= 60 s longer than leaving", t_read > t_leave + 60.0,
      f"{t_read:.0f} s vs {t_leave:.0f} s")
check("reading still locks before the 180 s horizon", t_read < 180.0, f"{t_read:.0f} s")
check("enforcing: ZERO hard locks on a present user", E["episodes"] > 0 and E["locks_on_present"] == 0)
dim_rate = E["dims_on_present"] / max(1, E["present_opportunities"])
print(f"    present decision opportunities {E['present_opportunities']}, short pauses (< 30 s) {E['short_pauses']}, "
      f"dimmed {E['short_dims']}")
check("enforcing: <= 10% of present opportunities get a dim", dim_rate <= 0.10, f"{dim_rate:.1%}")
short_rate = E["short_dims"] / max(1, E["short_pauses"])
check("enforcing: <= 1% of short pauses (< 30 s, typing rhythm) get a dim", short_rate <= 0.01,
      f"{E['short_dims']}/{E['short_pauses']} = {short_rate:.2%}")
cov = E["locked_departures"] / max(1, E["departures"])
check("enforcing: >= 90% of departures locked before 180 s", cov >= 0.90, f"{cov:.1%}")
L = st["learning"]
short_share = L["short_pauses"] / max(1, L["episodes"])
check("simulated episode mix matches the field profile (>= 85 % short)", short_share >= 0.85,
      f"{short_share:.1%} of {L['episodes']} learning episodes under 30 s")

section("5b. Gate calibration: does 'promoted' really mean 'within target'? (10 runs)")
print("  scenario   seed  promoted  gate rate/upper95   realised enforcing  hardlocks  coverage  median lat")
calib_ok, safety_ok, short_ok, n_promoted = True, True, True, 0
for ambiguous in (False, True):
    for seed in (1, 7, 42, 999, 2024):
        e_, s_, p_ = user_sim.run(days=60, seed=seed, ambiguous=ambiguous)
        E_ = s_["enforcing"]
        g = s_["gate_at_promotion"]
        real = user_sim.enforcing_fire_rate(s_)
        cov_ = E_["locked_departures"] / max(1, E_["departures"])
        lat = statistics.median(E_["latencies"]) if E_["latencies"] else float("nan")
        gtxt = f"{g['rate']:.1%}/{g['upper95']:.1%}" if g else "   (not promoted)"
        rtxt = f"{real:.1%}" if p_ is not None else "-"
        print(f"  {'ambiguous' if ambiguous else 'separable':9s}  {seed:4d}  "
              f"{str(p_) if p_ is not None else 'no':>8s}  {gtxt:>18s}   {rtxt:>18s}"
              f"  {E_['locks_on_present']:9d}  {cov_ if p_ is not None else 0:8.1%}  {lat:9.0f}"
              + ("   LearningExtended" if e_.modes.learning_extended else ""))
        safety_ok &= E_["locks_on_present"] == 0
        short_ok &= E_["short_dims"] <= 0.01 * max(1, E_["short_pauses"])
        if p_ is not None:
            n_promoted += 1
            calib_ok &= real <= e_.modes.target_fp
            calib_ok &= g["upper95"] <= e_.modes.target_fp      # gate obeyed its own rule
check("safety: zero hard locks on a present user in all 10 runs", safety_ok)
check("calibration: every promoted run stays within target in enforcing", calib_ok and n_promoted > 0,
      f"{n_promoted}/10 promoted")
check("typing rhythm: <= 1% of short pauses dimmed in all 10 runs", short_ok)

# --- 6 ----------------------------------------------------------------------------
section("6. Promotion gate: statistical, immune to first-passage noise, GPO override wins")


def gate(fp_count, positives=40, day=16, n=ModeController.WINDOW, spread_days=10):
    """n fired decisions (fp_count of them on a present user), spread evenly over spread_days."""
    mc = ModeController()
    mc.ensure_started(user_sim.BASE_TICKS)
    for i in range(n):
        at = user_sim.BASE_TICKS + (i * spread_days * TICKS_PER_DAY) // n
        mc.record_episode_outcome(True, i < fp_count, 60.0, at)
    mc.positives = positives
    mc.evaluate(user_sim.BASE_TICKS + int(day * TICKS_PER_DAY))
    return mc


m6 = gate(40)
check("20% window rate -> stays Learning", m6.mode == ModeController.LEARNING,
      f"upper95={m6.fp_upper_bound():.3f}")
m6 = gate(4)
check("2% window rate, day 16, 40 positives -> promotes", m6.mode == ModeController.ENFORCING,
      f"upper95={m6.fp_upper_bound():.3f}")
check("2% but only 10 positives -> stays", gate(4, positives=10).mode == ModeController.LEARNING)
check("2% but day 14 -> stays", gate(4, day=14).mode == ModeController.LEARNING)
check("2% but window not full (150) -> stays", gate(3, n=150).mode == ModeController.LEARNING)
m6 = gate(4, n=600, spread_days=3)  # a heavy user: 600 opportunities on 4 calendar days (BASE is 22:13)
check("600 clean opportunities on 4 different days -> stays (needs 5 days)",
      m6.window_days() == 4 and not m6.window_ready() and m6.mode == ModeController.LEARNING)
m6 = gate(4, spread_days=3)        # BASE_TICKS is 22:13 UTC: 3 x 24 h touch 4 calendar days
check("2% but the window spans only 4 different days -> stays",
      m6.window_days() == 4 and m6.mode == ModeController.LEARNING, f"days in window {m6.window_days()}")
m6 = gate(40, day=31)
check("unsafe after 30 days -> NOT promoted, flagged LearningExtended",
      m6.mode == ModeController.LEARNING and m6.learning_extended)
m6 = gate(4)
m6.evaluate(user_sim.BASE_TICKS + 16 * TICKS_PER_DAY, ModeController.FORCE_LEARNING)
check("GPO ForceLearning override wins", m6.mode == ModeController.LEARNING)


def bernoulli_stream(p, n, seed, per_day=40):
    rnd = random.Random(seed)
    mc = ModeController()
    mc.ensure_started(user_sim.BASE_TICKS)
    mc.positives = 40
    naive_crossings = 0
    for i in range(n):
        at = user_sim.BASE_TICKS + (i // per_day) * TICKS_PER_DAY
        mc.record_episode_outcome(True, rnd.random() < p, 60.0, at)
        if mc.count >= ModeController.WINDOW and mc.fp_ema <= mc.target_fp:
            naive_crossings += 1
        mc.evaluate(max(at, user_sim.BASE_TICKS + 20 * TICKS_PER_DAY))
        if mc.mode == ModeController.ENFORCING:
            return True, i, naive_crossings
    return False, n, naive_crossings


promo, at, naive = bernoulli_stream(0.15, 20000, seed=3)
print(f"  true rate 15%: 20000 episodes (~3 years) -> promoted={promo}; a naive EMA<=10% gate "
      f"would have fired {naive} times")
check("true 15% rate never promotes (no first-passage)", not promo and naive > 0)
promo, at, _ = bernoulli_stream(0.03, 20000, seed=3)
check("true 3% rate promotes promptly", promo and at < 400, f"after {at} episodes")

# --- 6b ---------------------------------------------------------------------------
section("6b. Field profile 2026-11-13: ~73 idle episodes per active hour, >= 85 % under 30 s")


class ModeController070(ModeController):
    """The 0.7.0 rule, for comparison only: every episode counted, 200 newest, no day spread."""
    OPPORTUNITY_SECONDS = 0.0
    MIN_WINDOW_DAYS = 0


def field_stream(mc, seed, wrong_per_hour=0.0, unverified_per_hour=0.0, days=31, hours=6):
    """Per active hour 73 episodes: 66 short typing pauses (2-29 s, no decision), the rest >= 30 s.
    Some of the long ones carry a decision: a verified wrong dim (Poisson), or an unverified
    invisible fire. Departures (30 positives) are recorded early. Returns the promotion day or None."""
    rnd = random.Random(seed)
    mc.ensure_started(user_sim.BASE_TICKS)
    mc.positives = 40
    for day in range(days):
        for h in range(hours):
            for k in range(73):
                at = user_sim.BASE_TICKS + day * TICKS_PER_DAY + ((8 + h) * 3600 + k * 49) * SEC
                if k < 66:
                    mc.record_episode_outcome(False, False, float(rnd.randint(2, 29)), at)
                elif rnd.random() < wrong_per_hour / 7:
                    mc.record_episode_outcome(True, True, 45.0, at)
                elif rnd.random() < unverified_per_hour / 6:
                    mc.record_unverified_fire(at)
                else:
                    mc.record_episode_outcome(False, False, float(rnd.randint(30, 300)), at)
                mc.evaluate(at)
                if mc.mode == ModeController.ENFORCING:
                    return day
    return None


for name, kw in (("1 unverified invisible fire per active hour", dict(unverified_per_hour=1.0)),
                 ("1 verified wrong dim per active hour (Poisson)", dict(wrong_per_hour=1.0))):
    old_day = field_stream(ModeController070(), 5, **kw)
    new_mc = ModeController()
    new_day = field_stream(new_mc, 5, **kw)
    print(f"  {name}: 0.7.0 rule promoted on day {old_day}; 0.7.1 rule: {new_day} "
          f"(window {new_mc.window_n()} opportunities over {new_mc.window_days()} days, upper95 {new_mc.fp_upper_bound():.1%}, "
          f"{new_mc.short_ignored} short episodes not counted)")
    check(f"field reproduction, {name}: the 0.7.0 rule promotes (the defect)", old_day is not None, f"day {old_day}")
    check(f"field reproduction, {name}: the 0.7.1 rule never promotes in 31 days", new_day is None)
clean_mc = ModeController()
clean_day = field_stream(clean_mc, 5)
check("clean field user (no wrong decisions) is promoted after day 15", clean_day is not None and clean_day >= 15,
      f"day {clean_day}, window over {clean_mc.window_days()} days")

# --- 7 ----------------------------------------------------------------------------
section("7. Enforcing-mode real lock: quick unlock = FP, long unlock = reinforce")


def drive_to_lock(engine, sig, now):
    engine.begin_episode(sig, now)
    for s in range(1, 120):
        engine.update_live(float(s))
        a, _ = engine.tick(now + s * SEC)
        if a == PresenceEngine.TRIGGER_LOCK:
            return now + s * SEC
    return None


now = user_sim.BASE_TICKS
e1 = PresenceEngine(); e1.modes.mode = ModeController.ENFORCING
lk = drive_to_lock(e1, leaving_sig(), now)
check("real lock fired in enforcing mode", lk is not None)
b = e1.model.time_to_prob(leaving_sig(), 0.90)
e1.apply_enforced_lock_outcome(lk + 4 * SEC)
a = e1.model.time_to_prob(leaving_sig(), 0.90)
print(f"  unlock after 4 s:   t(90%) {b:.1f} -> {a:.1f} s")
check("quick unlock backs the model off", a > b)
e2 = PresenceEngine(); e2.modes.mode = ModeController.ENFORCING
lk = drive_to_lock(e2, leaving_sig(), now)
b = e2.model.time_to_prob(leaving_sig(), 0.90)
e2.apply_enforced_lock_outcome(lk + 600 * SEC)
a = e2.model.time_to_prob(leaving_sig(), 0.90)
print(f"  unlock after 600 s: t(90%) {b:.1f} -> {a:.1f} s")
check("correct lock reinforces (never backs off)", a <= b + 1e-9)
check("no double-count: pending cleared", not e2._pending_lock_active)

# --- 8 ----------------------------------------------------------------------------
section("8. Learning mode + 'Visa låsning': user flag teaches, never double-counts")
e = PresenceEngine()
now = user_sim.BASE_TICKS
lk = drive_to_lock(e, reading_sig(), now)                 # invisible would-lock
check("would-lock fired silently in Learning", lk is not None and e.modes.mode == ModeController.LEARNING)
e.on_input_resumed(lk + 20 * SEC)                         # resumed after the FP window
fp_before_flag = e.modes.fp_ema
b = e.model.time_to_prob(reading_sig(), 0.90)
applied = e.on_user_flagged_unjustified(lk + 25 * SEC)
a = e.model.time_to_prob(reading_sig(), 0.90)
print(f"  flag applied={applied}: t(90%) {b:.1f} -> {a:.1f} s, fpEMA {fp_before_flag:.3f} -> {e.modes.fp_ema:.3f}")
check("flag applied and model backs off", applied and a > b)
check("second flag for same decision is ignored", e.on_user_flagged_unjustified(lk + 30 * SEC) is False)
e3 = PresenceEngine()
lk = drive_to_lock(e3, reading_sig(), now)
e3.on_input_resumed(lk + 2 * SEC)                         # already labelled FP by timing
check("flag after an automatic FP label is ignored", e3.on_user_flagged_unjustified(lk + 5 * SEC) is False)
e4 = PresenceEngine()
lk = drive_to_lock(e4, reading_sig(), now)
e4.on_input_resumed(lk + 40 * SEC)
check("invisible fire + late resume counts AGAINST promotion", e4.modes.fp_ema > 0.0,
      f"fpEMA={e4.modes.fp_ema:.3f}")

# --- summary ----------------------------------------------------------------------
section("SUMMARY")
passed = sum(1 for _, c in results if c)
for name, c in results:
    print(f"  [{'PASS' if c else 'FAIL'}] {name}")
print(f"\n  {passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
