#!/usr/bin/env python3
"""
analyse_profile.py
==================
Offline analysis of an exported PresenceLock profile (tray menu "Exportera profil...", --export, or a
collected file). Mirrors ProfileDiagnostics.cs (the same ERROR / WARN / INFO checks) and adds what
only an offline reader can do: decoding the time line and the silence profile.

    python3 verify/analyse_profile.py <profile.json> [--check]

--check: exit 1 on ERROR; and when <profile>.expected.json exists (written by the C# test suite
for the synthetic fixture), require the same window and model figures as the C# implementation.

Uses the bit-exact Python reference model (presence_reference.py) for decision times. Reads the
file only. The profile may hold a user's SID and machine name: do not commit real profiles.
"""
import datetime
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from presence_reference import PresenceModel, ModeController, N, CTX_READING, CTX_LEAVING, REMOTE_SESSION  # noqa: E402

TPD = 864_000_000_000
TPS = 10_000_000
NAMES = ["ScrollFrac", "Deceleration", "AbruptStop", "EdgeFling", "MicroJerk", "CtxReading", "CtxLeaving",
         "TimeDepartPrior", "AudioPresent", "AudioDopplerAway", "BleRssiDrop", "PostHold", "RemoteSession"]
CONTEXTS = ["neutral", "silent-work", "leaving"]
SILENCE_BINS, SILENCE_MIN, SILENCE_WIDTH = 48, 30.0, 0.1


def utc(ticks):
    if not ticks:
        return "-"
    return (datetime.datetime(1, 1, 1) + datetime.timedelta(microseconds=ticks // 10)).strftime("%Y-%m-%d %H:%M:%S UTC")


def model_of(m):
    pm = PresenceModel()
    pm.W0, pm.U0, pm.W, pm.U = m["W0"], m["U0"], list(m["W"]), list(m["U"])
    pm.rate_clip = m.get("RateParamClip", 6.0)
    return pm


def evidence(modes):
    """Mirror of ModeController.Evidence() (0.7.1): newest outcomes back to >= 200 on >= 5 days."""
    fire, day = modes.get("FireWindow"), modes.get("DayWindow")
    if fire is None or day is None or modes.get("WindowRule", 0) != 2:
        return None
    cap, head, count = len(fire), modes["WindowHead"], modes["WindowCount"]
    days, n, k, right, wrong, unverified, ready = set(), 0, 0, 0, 0, 0, False
    for age in range(count):
        i = (head - 1 - age) % cap
        f = fire[i]
        n += 1
        k += f in (2, 3)
        right += f == 1
        wrong += f == 2
        unverified += f == 3
        days.add(day[i])
        if n >= ModeController.WINDOW and len(days) >= ModeController.MIN_WINDOW_DAYS:
            ready = True
            break
    return {"window_n": n, "window_k": k, "window_days": len(days), "window_ready": ready,
            "right": right, "wrong": wrong, "unverified": unverified,
            "upper95": ModeController.wilson_upper(k, n) if n else 1.0}


def analyse(p, out):
    findings = []

    def add(sev, code, text):
        findings.append((sev, code, text))

    mc, st, cfg = p["Modes"], p.get("Stats") or {}, p["Config"]
    created, updated, first = p.get("CreatedUtcTicks", 0), p.get("UpdatedUtcTicks", 0), mc.get("FirstSeenUtcTicks", 0)
    add("INFO", "version", f"written by {p.get('AppVersion', '?')}, schema {p.get('SchemaVersion')}")
    origin = p.get("Origin") or "unknown (profile written before 0.7.1)"
    add("WARN" if origin.startswith("recreated") else "INFO", "origin", origin)
    add("INFO", "time", f"created {utc(created)}, learning since {utc(first)}, updated {utc(updated)}"
        + (f" ({(updated - created) / TPS / 3600:.1f} h)" if created and updated else ""))
    if created and updated and updated + TPD < created:
        add("ERROR", "time", "updated before created")
    if created and first and first + TPD < created:
        add("ERROR", "time", "learning started before the profile was created")

    m = p["Model"]
    if not all(math.isfinite(v) for v in [m["W0"], m["U0"]] + list(m["W"]) + list(m["U"])):
        add("ERROR", "model", "non-finite weight")
    if mc.get("RejectedDecisions", 0) > mc.get("FiredDecisions", 0):
        add("ERROR", "counters", "more rejected decisions than decisions")
    for i, (seen, avail) in enumerate(zip(p.get("OptionalSeen", []), p.get("OptionalAvailable", []))):
        if avail > seen:
            add("ERROR", "counters", f"sensor {NAMES[i]} available more often than observed")
    if "PushSequence" in mc and mc["WindowCount"] > mc["PushSequence"]:
        add("ERROR", "counters", "more outcomes stored than ever recorded")
    by_ctx = st.get("EpisodesByContext") or [0, 0, 0]
    episodes = sum(by_ctx)
    if st.get("RemoteEpisodes", 0) > episodes or st.get("PostHoldEpisodes", 0) > episodes:
        add("ERROR", "counters", "remote/post-hold episodes exceed all episodes")

    ev = evidence(mc)
    if ev is None:
        add("INFO", "gate", f"mode {'Enforcing' if mc['Mode'] == 1 else 'Learning'}; window recorded under the rule of "
            "0.7.0 or older (every 2-s pause counted): it is discarded when 0.7.1 loads the profile")
    else:
        add("INFO", "gate", f"mode {'Enforcing' if mc['Mode'] == 1 else 'Learning'}; window {ev['window_n']} opportunities "
            f"on {ev['window_days']} days ({'ready' if ev['window_ready'] else 'collecting'}); per opportunity wrong "
            f"{ev['window_k'] / max(1, ev['window_n']):.1%}, upper95 {ev['upper95']:.1%} (<= {mc['TargetFalsePositiveRate']:.0%}); "
            f"decisions {ev['right']} right, {ev['wrong']} wrong, {ev['unverified']} unverified; "
            f"positives {mc['ConfirmedPositives']}/{mc['MinConfirmedPositives']}; "
            f"+{mc.get('ShortEpisodesIgnored', 0)} typing pauses not counted")
    if (p.get("Quality") or {}).get("Degraded"):
        add("WARN", "quality", "enforcing-mode quality below target")
    if episodes:
        add("INFO", "coverage", f"episodes by context: neutral {by_ctx[0]}, silent-work {by_ctx[1]}, leaving {by_ctx[2]}; "
            f"Remote Desktop {st.get('RemoteEpisodes', 0)}; after media/meeting {st.get('PostHoldEpisodes', 0)}")
        if episodes >= 200 and by_ctx[1] == 0:
            add("WARN", "coverage", "no episode in a silent-work application: if the user works in CAD/PDF/Office/IDE/calls, "
                "its process name is missing from the reading list (policy ExtraReadingApps)")
    else:
        add("INFO", "coverage", "no context counters (profile written before 0.7.1); see the learned weights below")

    pm, factory = model_of(m), PresenceModel()
    rows = []
    for name, idx in (("neutral", None), ("silent-work", CTX_READING), ("leaving", CTX_LEAVING), ("Remote Desktop", REMOTE_SESSION)):
        x = [0.0] * N
        if idx is not None:
            x[idx] = 1.0
        rows.append(f"{name} {pm.lock_time(x, cfg['SoftDimThreshold'], 900.0):.0f} / {pm.lock_time(x, cfg['LockThreshold'], 900.0):.0f} s")
    x0 = [0.0] * N
    add("INFO", "model", "dim / lock: " + "; ".join(rows) +
        f" (factory model: {factory.lock_time(x0, cfg['SoftDimThreshold'], 900.0):.0f} / {factory.lock_time(x0, cfg['LockThreshold'], 900.0):.0f} s)")
    nonzero = [f"{NAMES[i]} w={m['W'][i]:+.3g} u={m['U'][i]:+.3g}" for i in range(N) if m["W"][i] or m["U"][i]]
    add("INFO", "model", "features with learned weights: " + (", ".join(nonzero) if nonzero else "none"))
    g = p.get("Guard") or {}
    if g.get("SumW"):
        add("INFO", "kaizen", f"{g.get('Count', 0)} labels since the last guard decision, weight {g['SumW']:g}; live model "
            f"{-g['SumWD'] / g['SumW']:+.2f} nat per weight better than the champion (prequential); "
            f"promotions {g.get('Promotions', 0)}, rollbacks {g.get('Rollbacks', 0)}")

    sil = p.get("Silence") or {}
    counts, last, hl = sil.get("Counts") or [], sil.get("LastUpdateUtcTicks", 0), sil.get("HalfLifeDays", 14.0)
    if counts and last:
        for ctx in range(len(counts) // SILENCE_BINS):
            cells = []
            for b in range(SILENCE_BINS):
                v = counts[ctx * SILENCE_BINS + b]
                if v <= 0:
                    continue
                lo, hi = SILENCE_MIN * math.exp(SILENCE_WIDTH * b), SILENCE_MIN * math.exp(SILENCE_WIDTH * (b + 1))
                k = max(1, round(v))
                cell = f"{lo:.0f}-{hi:.0f} s x{k}"
                if k == 1:   # a single record: its decay tells when it was recorded
                    age = -hl * math.log2(min(1.0, v)) * TPD
                    cell += f" ({utc(last - int(age))[11:16]})"
                cells.append(cell)
            if cells:
                add("INFO", "silence", f"{CONTEXTS[ctx]}: " + ", ".join(cells))
    for sev, code, text in findings:
        print(f"[{sev}] {code}: {text}", file=out)
    return findings, ev, pm


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path, check = argv[1], "--check" in argv
    with open(path, encoding="utf-8") as fh:
        p = json.load(fh)
    findings, ev, pm = analyse(p, sys.stdout)
    errors = sum(1 for s, _, _ in findings if s == "ERROR")
    if check:
        exp_path = os.path.splitext(path)[0] + ".expected.json"
        if os.path.exists(exp_path):
            with open(exp_path, encoding="utf-8") as fh:
                exp = json.load(fh)
            cfg, x0 = p["Config"], [0.0] * N
            mine = dict(ev or {})
            mine["neutral_dim"] = pm.lock_time(x0, cfg["SoftDimThreshold"], 900.0)
            mine["neutral_lock"] = pm.lock_time(x0, cfg["LockThreshold"], 900.0)
            for key, want in exp.items():
                got = mine.get(key)
                ok = (abs(got - want) <= 1e-9) if isinstance(want, float) else got == want
                print(f"  [{'PASS' if ok else 'FAIL'}] {key}: Python {got} vs C# {want}")
                errors += 0 if ok else 1
        print(f"\n{'OK' if errors == 0 else 'FAILED'}: {errors} error(s)")
        return 1 if errors else 0
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
