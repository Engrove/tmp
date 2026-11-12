#!/usr/bin/env bash
# Runs the complete proof chain. Exit code != 0 if anything fails.
#   1. Python reference: algorithm, gradients, 60-day simulations, gate calibration
#   2. Goertzel DSP check (optional ultrasonic sensor)
#   3. ADMX/ADML <-> PolicyReader.cs consistency
#   4. Regenerate the parity golden file from the Python reference
#   5. C# unit + parity tests against the REAL engine (bit-exact comparison)
#   6. Compile the Windows agent (net48) with warnings as errors
set -euo pipefail
cd "$(dirname "$0")/.."
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

step() { printf '\n######## %s\n' "$1"; }
step "1/6 Python reference verification";   python3 verify/run_verification.py | tail -4
step "2/6 Goertzel DSP";                    python3 verify/goertzel_check.py | tail -2
step "3/6 ADMX consistency";                python3 verify/check_admx.py | tail -2
step "4/6 Parity golden file";              python3 verify/export_parity.py
step "5/6 C# tests (real engine)";          dotnet test tests/PresenceLock.Core.Tests -c Release --nologo 2>&1 | grep -E "Passed!|Failed!|error" 
step "6/6 Build Windows agent (net48)";     dotnet build src/PresenceLock.App -c Release --nologo 2>&1 | grep -E "Warning\(s\)|Error\(s\)|->"
printf '\nALL CHECKS PASSED\n'
