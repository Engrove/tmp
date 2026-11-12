using System;

namespace PresenceLock.App.Sensors
{
    /// <summary>
    /// OPTIONAL, learning-only passive presence hint from Bluetooth LE advertisement
    /// RSSI fluctuation. A body sitting in front of the machine attenuates nearby BLE
    /// beacons fairly steadily; when the user leaves, the RSSI of nearby devices shifts.
    ///
    /// HONEST SCOPE: the production source is WinRT's BluetoothLEAdvertisementWatcher
    /// (no admin, no pairing, no extra consent prompt on a machine with a BT radio). That
    /// needs a WinRT projection reference and is intentionally left as an opt-in adapter
    /// rather than a half-working import in this build. Default OFF; when unavailable the
    /// feature is marked unavailable and is ignored in enforcing mode. RSSI presence is
    /// genuinely noisy, so it is only ever a weak, learned contributor — never a trigger
    /// on its own.
    /// </summary>
    public sealed class BleRssiSensor
    {
        public bool Enabled { get; }
        public bool IsAvailable { get; private set; }

        private double _baselineRssi = double.NaN;

        public BleRssiSensor(bool enabled)
        {
            Enabled = enabled;
            IsAvailable = false; // set true only once a watcher adapter is attached and delivering
        }

        /// <summary>Feed a smoothed aggregate RSSI (dBm). Returns a [0,1] "moving" estimate.</summary>
        public double Update(double aggregateRssiDbm)
        {
            if (double.IsNaN(_baselineRssi)) { _baselineRssi = aggregateRssiDbm; return 0.0; }
            // Exponential baseline; a sudden deviation suggests the body moved.
            double deviation = Math.Abs(aggregateRssiDbm - _baselineRssi);
            _baselineRssi = 0.95 * _baselineRssi + 0.05 * aggregateRssiDbm;
            return Math.Min(1.0, deviation / 8.0); // ~8 dBm swing => full scale
        }
    }
}
