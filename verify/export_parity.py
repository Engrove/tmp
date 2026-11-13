#!/usr/bin/env python3
"""
export_parity.py
================
Runs the deterministic user simulation with the Python reference and writes the final
model parameters and counters to verify/parity_golden.json. The C# test project replays
the identical scenario against the REAL C# engine (PresenceLock.Core) and requires the
results to match. json.dump writes floats with repr(), which round-trips exactly.

    python3 verify/export_parity.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_sim

CONFIGS = [
    {"name": "separable_s12345_d60", "seed": 12345, "days": 60, "ambiguous": False},
    {"name": "ambiguous_s42_d60",    "seed": 42,    "days": 60, "ambiguous": True},
    {"name": "ambiguous_s999_d45",   "seed": 999,   "days": 45, "ambiguous": True},
]


def snapshot(eng, stats, promoted_day):
    m, mc = eng.model, eng.modes
    return {
        "W0": m.W0, "U0": m.U0, "W": list(m.W), "U": list(m.U),
        "mode": mc.mode, "learning_extended": mc.learning_extended,
        "positives": mc.positives, "fired": mc.fired, "rejected": mc.rejected,
        "window_count": mc.count, "window_head": mc.head, "window_fp": mc.window_fp(),
        "window_n": mc.window_n(), "window_ready": mc.window_ready(),
        "window_days": mc.window_days(), "short_ignored": mc.short_ignored,
        "promoted_at": mc.promoted_at, "promotion_ub": mc.promotion_ub,
        "promoted_day": promoted_day,
        "enforcing": {k: v for k, v in stats["enforcing"].items() if k != "latencies"},
        "learning": {k: v for k, v in stats["learning"].items() if k != "latencies"},
        "enforcing_latency_sum": sum(stats["enforcing"]["latencies"]),
    }


def main():
    out = {"generator": "verify/export_parity.py", "cases": []}
    for c in CONFIGS:
        eng, stats, promoted = user_sim.run(days=c["days"], seed=c["seed"], ambiguous=c["ambiguous"])
        case = dict(c)
        case["expected"] = snapshot(eng, stats, promoted)
        out["cases"].append(case)
        print(f"  {c['name']:24s} mode={eng.modes.mode:9s} promoted_day={promoted} "
              f"W0={eng.model.W0:+.6f} U0={eng.model.U0:+.6f}")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "parity_golden.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"  wrote {path}")


if __name__ == "__main__":
    main()
