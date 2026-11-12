using PresenceLock.Core;

namespace PresenceLock.App.Settings
{
    /// <summary>
    /// Effective runtime settings = built-in defaults, overlaid by HKCU preferences (only the
    /// user-facing "Visa låsning" toggle), then HKCU policy, then HKLM policy (GPO), which
    /// always wins. Nullable engine overrides mean "keep the value already in the profile".
    /// </summary>
    public sealed class AppSettings
    {
        public ModePolicy ModePolicy = ModePolicy.Auto;

        /// <summary>"Visa låsning": in learning mode, show a notice the user can click to flag
        /// a would-be lock as unjustified (a strong training label that speeds learning).</summary>
        public bool ShowLockNotification = false;
        /// <summary>True when the value above is set by policy (the tray toggle is then disabled).</summary>
        public bool ShowLockNotificationLocked = false;

        // Optional sensors — OFF unless policy explicitly opts in.
        public bool EnableAudioSonar = false;
        public bool EnableBleRssi = false;

        // Optional engine overrides (null = keep profile value).
        public double? SoftDimThreshold;
        public double? LockThreshold;
        public int? MinLearningDays;
        public int? MaxLearningDays;
        public double? TargetFalsePositiveRate;

        // Extra app classification lists (process names, no ".exe").
        public string[] ExtraReadingApps = new string[0];
        public string[] ExtraLeavingApps = new string[0];

        // Administration.
        public bool AllowUserExit = true;
        public bool AllowProfileExport = true;
        public string ProfileExportDirectory = "";   // e.g. \\srv\share$\PresenceLock (daily export)
        public string BaselineProfilePath = "";      // seed for users without a local profile

        /// <summary>Apply the non-null overrides onto a profile before the engine runs.</summary>
        public void ApplyTo(UserProfile profile)
        {
            if (SoftDimThreshold.HasValue) profile.Config.SoftDimThreshold = SoftDimThreshold.Value;
            if (LockThreshold.HasValue) profile.Config.LockThreshold = LockThreshold.Value;
            if (MinLearningDays.HasValue) profile.Modes.MinLearningDays = MinLearningDays.Value;
            if (MaxLearningDays.HasValue) profile.Modes.MaxLearningDays = MaxLearningDays.Value;
            if (TargetFalsePositiveRate.HasValue) profile.Modes.TargetFalsePositiveRate = TargetFalsePositiveRate.Value;
            profile.Config.EnableAudioSonar = EnableAudioSonar;
            profile.Config.EnableBleRssi = EnableBleRssi;
        }
    }
}
