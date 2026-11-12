#!/usr/bin/env python3
"""
goertzel_check.py
=================
Verifies the single-bin Goertzel detector that AudioSonarSensor.cs ships (the DSP half
of the optional ultrasonic sensor). Mirrors the C# Goertzel exactly. Run:
    python3 verify/goertzel_check.py
"""
import math, sys

SR = 48000.0
BLOCK = 2048

class Goertzel:
    def __init__(self, target, sr, block):
        k = round(block * target / sr)
        omega = 2.0 * math.pi * k / block
        self.coeff = 2.0 * math.cos(omega)
        self.s1 = self.s2 = 0.0
        self.block = block
    def add(self, x):
        s0 = self.coeff * self.s1 - self.s2 + x
        self.s2 = self.s1
        self.s1 = s0
    def power(self):
        p = self.s1*self.s1 + self.s2*self.s2 - self.coeff*self.s1*self.s2
        return p / (self.block*self.block)

def tone_power(freq):
    gp = Goertzel(20000.0, SR, BLOCK)
    gl = Goertzel(19800.0, SR, BLOCK)
    gu = Goertzel(20200.0, SR, BLOCK)
    for n in range(BLOCK):
        x = 0.5 * math.sin(2*math.pi*freq*n/SR)
        gp.add(x); gl.add(x); gu.add(x)
    return gp.power(), gl.power(), gu.power()

ok = True
print("="*70)
print("Goertzel single-bin detector")
print("="*70)

# 1) pure 20 kHz probe tone concentrates in the probe bin
p, lo, hi = tone_power(20000.0)
cond = p > 10*lo and p > 10*hi
ok &= cond
print(f"  20.000 kHz tone -> probe={p:.3e}  lower={lo:.3e}  upper={hi:.3e}")
print(f"  [{'PASS' if cond else 'FAIL'}] probe bin dominates")

# 2) receding (downshifted) echo pushes energy into the LOWER side bin
p, lo, hi = tone_power(19900.0)
cond = lo > hi
ok &= cond
imb = (lo-hi)/(lo+hi)
print(f"  19.900 kHz (receding) -> lower={lo:.3e} > upper={hi:.3e}  imbalance={imb:+.3f}")
print(f"  [{'PASS' if cond else 'FAIL'}] doppler-away detected (lower>upper)")

# 3) approaching (upshifted) echo pushes energy into the UPPER side bin
p, lo, hi = tone_power(20100.0)
cond = hi > lo
ok &= cond
print(f"  20.100 kHz (approaching) -> upper={hi:.3e} > lower={lo:.3e}")
print(f"  [{'PASS' if cond else 'FAIL'}] approach does NOT read as away")

print("\n  " + ("ALL GOERTZEL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
sys.exit(0 if ok else 1)
