using System;
using System.Windows.Forms;
using PresenceLock.App.Interop;
using PresenceLock.Core;

namespace PresenceLock.App.Sensors
{
    /// <summary>
    /// Assembles the FeatureVector "signature" at the moment input stops, by combining
    /// the always-available core sensors with any enabled optional ones. Optional
    /// features carry an Available flag so the engine can mask them out in enforcing
    /// mode if they were never confirmed reliable.
    /// </summary>
    public sealed class FeatureBuilder
    {
        private readonly KinematicsTracker _kin;
        private readonly ForegroundMonitor _fg;
        private readonly TimePrior _time;
        private readonly AudioSonarSensor _sonar;
        private readonly BleRssiSensor _ble;

        public FeatureBuilder(KinematicsTracker kin, ForegroundMonitor fg, TimePrior time,
                              AudioSonarSensor sonar, BleRssiSensor ble)
        {
            _kin = kin; _fg = fg; _time = time; _sonar = sonar; _ble = ble;
        }

        public FeatureVector BuildSignature()
        {
            var fv = new FeatureVector();

            // --- kinematics ---
            NativeMethods.GetCursorPos(out var cursor);
            var vs = SystemInformation.VirtualScreen;
            _kin.WriteFeatures(fv, cursor.X, cursor.Y, vs.Left, vs.Top, vs.Right, vs.Bottom,
                               MonoClock.NowTicks, NativeMethods.IdleSecondsOrNaN() is double idle && !double.IsNaN(idle) ? idle : 0);

            // --- foreground context ---
            var cat = _fg.CurrentCategory();
            fv.X[FeatureSchema.CtxReading] = cat == ForegroundCategory.Reading ? 1.0 : 0.0;
            fv.X[FeatureSchema.CtxLeaving] = cat == ForegroundCategory.Leaving ? 1.0 : 0.0;

            // --- time-of-day prior ---
            fv.X[FeatureSchema.TimeDepartPrior] = _time.Value(DateTime.Now);

            // --- console vs Remote Desktop (different input and working style) ---
            fv.X[FeatureSchema.RemoteSession] = NativeMethods.IsRemoteSession() ? 1.0 : 0.0;

            // --- optional sensors (marked unavailable unless they actually produced data) ---
            fv.Available[FeatureSchema.AudioPresent] = false;
            fv.Available[FeatureSchema.AudioDopplerAway] = false;
            fv.Available[FeatureSchema.BleRssiDrop] = false;

            if (_sonar != null && _sonar.IsAvailable)
            {
                // Live values are updated by the orchestrator's audio pump; here we just
                // mark availability so the episode counts toward sensor confirmation.
                fv.Available[FeatureSchema.AudioPresent] = true;
                fv.Available[FeatureSchema.AudioDopplerAway] = true;
            }
            if (_ble != null && _ble.IsAvailable)
            {
                fv.Available[FeatureSchema.BleRssiDrop] = true;
            }

            return fv;
        }
    }
}
