namespace PresenceLock.Core
{
    /// <summary>
    /// Fixed feature layout shared by the model, the Windows feature-builder and the
    /// Python reference implementation in /verify. The index order is a wire contract:
    /// never reorder, only append, and bump UserProfile.SchemaVersion if you do.
    ///
    /// All features are designed to be computable from signals that need NO extra user
    /// consent on a stock Windows 10/11 box:
    ///   * raw input kinematics (RegisterRawInputDevices / WM_INPUT)
    ///   * foreground process name + audio-session render state
    ///   * clock / calendar-free time-of-day prior
    /// The three OPTIONAL features (audio sonar, BLE RSSI) are only ever populated when
    /// the corresponding sensor is both enabled by policy AND proven usable. In enforcing
    /// mode any feature whose availability was not confirmed during learning is forced to
    /// 0, so the model can never *depend* on a sensor that may vanish in mode 2.
    /// </summary>
    public static class FeatureSchema
    {
        // --- reliable core (always available) -------------------------------------
        public const int ScrollFrac      = 0; // fraction of last-3s input events that were wheel scroll (reading)
        public const int Deceleration    = 1; // smoothness of pointer deceleration before stop, 0..1 (parking the mouse)
        public const int AbruptStop      = 2; // 1 = high-speed motion then instant nothing (tvärstopp)
        public const int EdgeFling       = 3; // 1 = last motion flung toward a screen edge / window close
        public const int MicroJerk       = 4; // 1 = 1-3px micro twitch at release (hand leaving mouse / chair pushback)
        public const int CtxReading      = 5; // 1 = foreground is an active read/review app (PDF/CAD/IDE/active call/compiling)
        public const int CtxLeaving      = 6; // 1 = desktop/lock dialog/inbox, or just after Ctrl+S / closed tab
        public const int TimeDepartPrior = 7; // learned prior that this minute-of-day tends to precede absence, 0..1

        // --- optional (learning-only unless proven) -------------------------------
        public const int AudioPresent     = 8;  // centered 0: +ve stable echo (body present), -ve otherwise
        public const int AudioDopplerAway = 9;  // negative Doppler in 19.5-20.5 kHz band (moving away), 0..1
        public const int BleRssiDrop      = 10; // BLE/Wi-Fi RSSI change consistent with the body moving, 0..1

        // --- schema v2 ------------------------------------------------------------
        /// <summary>
        /// 1 = this episode started when a passive hold (visible media / meeting) ENDED while
        /// the user was still idle. Its kinematic features are zeroed (they would be minutes
        /// old), so the model learns a separate "after the video/meeting" latency.
        /// </summary>
        public const int PostHold = 11;

        public const int Count = 12;

        /// <summary>Indices of the five raw-input kinematic features.</summary>
        public static readonly int[] Kinematic = { ScrollFrac, Deceleration, AbruptStop, EdgeFling, MicroJerk };

        public static readonly string[] Names =
        {
            "ScrollFrac", "Deceleration", "AbruptStop", "EdgeFling", "MicroJerk",
            "CtxReading", "CtxLeaving", "TimeDepartPrior",
            "AudioPresent", "AudioDopplerAway", "BleRssiDrop",
            "PostHold"
        };

        /// <summary>true for features that come from optional/extra sensors.</summary>
        public static readonly bool[] Optional =
        {
            false, false, false, false, false,
            false, false, false,
            true, true, true,
            false
        };
    }
}
