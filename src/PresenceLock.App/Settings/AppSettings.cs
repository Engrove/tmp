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

        // Passive hold (visible media / meeting) and the absolute backstop.
        public bool MediaHoldEnabled = true;
        public bool MeetingHoldEnabled = true;
        public int HoldMaxMinutes = 15;          // absolute cap: visible confirmation dim after this much idle
        public int MaxLearnedHorizonMinutes = 10; // learned certain-absence horizon may grow from 3 min up to this
        public int ConfirmGraceSeconds = 15;     // confirmation dim -> lock if unanswered
        public string[] HoldIgnoreApps = new string[0];

        // Habit (routine) learning: may only bring a confirmation dim forward, never postpone.
        public bool HabitLearningEnabled = true;
        public int HabitEarlyConfirmMinutes = 2;

        // Administration.
        public bool AllowUserExit = true;
        public bool AllowProfileExport = true;
        public string ProfileExportDirectory = "";   // e.g. \\srv\share$\PresenceLock (daily export)

        // Data retention (cleaning service, every 24 h): nothing is kept longer than this.
        public int LogRetentionDays = 30;
        public int ProtectedCopyRetentionDays = 180;
        public int CollectedProfileRetentionDays = 90;

        public RetentionPolicy ToRetentionPolicy() => new RetentionPolicy
        {
            LogRetentionDays = LogRetentionDays,
            ProtectedCopyRetentionDays = ProtectedCopyRetentionDays,
            CollectedProfileRetentionDays = CollectedProfileRetentionDays
        };
        public string BaselineProfilePath = "";      // seed for users without a local profile

        public CoordinatorConfig ToCoordinatorConfig() => new CoordinatorConfig
        {
            MediaHoldEnabled = MediaHoldEnabled,
            MeetingHoldEnabled = MeetingHoldEnabled,
            HoldMaxSeconds = HoldMaxMinutes * 60.0,
            MaxLearnedHorizonSeconds = MaxLearnedHorizonMinutes * 60.0,
            ConfirmGraceSeconds = ConfirmGraceSeconds,
            HabitEarlySeconds = HabitEarlyConfirmMinutes * 60.0
        };

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
