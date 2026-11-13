using System;
using System.Runtime.Serialization;

namespace PresenceLock.Core
{
    /// <summary>
    /// Thresholds and knobs that govern the decision state machine. Persisted with the
    /// profile and overridable from GPO/registry at startup.
    /// </summary>
    [DataContract]
    public sealed class EngineConfig
    {
        [DataMember] public double SoftDimThreshold = 0.75;        // enter 3 s warning dim
        [DataMember] public double LockThreshold = 0.90;           // escalate to lock
        [DataMember] public int SoftDimSeconds = 3;                // grace window
        [DataMember] public int FalsePositiveWindowSeconds = 10;   // unlock/resume within -> FP
        [DataMember] public int LongAbsenceSeconds = 180;          // idle beyond -> certain absence
        [DataMember] public int MinSensorConfirmations = 50;       // episodes an optional sensor must appear in
        [DataMember] public double SensorAvailabilityFraction = 0.80;

        // Optional sensors are OFF by default: they require explicit policy opt-in and
        // are never assumed available in enforcing mode.
        [DataMember] public bool EnableAudioSonar = false;
        [DataMember] public bool EnableBleRssi = false;
    }

    /// <summary>
    /// The complete, per-user, on-disk profile. One file per Windows account under
    /// %LOCALAPPDATA%\PresenceLock\profile.json. Contains ONLY model weights, calibration
    /// counters and non-content metadata — never window titles, never document content,
    /// never raw audio. Safe to export as an admin baseline.
    /// </summary>
    /// <summary>
    /// Counters for the parts of the decision flow that are NOT learned (passive hold,
    /// hold probes, absolute backstop). Exported so the administrator can judge whether
    /// HoldMaxMinutes / ConfirmGraceSeconds are set right. No timestamps, no app names.
    /// </summary>
    [DataContract]
    public sealed class CoordinatorStats
    {
        [DataMember] public int HoldStarts;            // idle periods that entered a hold: media, meeting or the user's own pause
        [DataMember] public int HoldAbortedEpisodes;   // model episodes discarded because a hold began
        [DataMember] public int HoldProbes;            // visible "are you still there" dims after HoldMax
        [DataMember] public int HoldProbesAnswered;    // ... answered by the user (present)
        [DataMember] public int HoldProbeLocks;        // ... unanswered -> locked
        [DataMember] public int HoldProbeQuickUnlocks; // ... locked but unlocked within the FP window
        [DataMember] public int BackstopDims;          // certain-absence horizon reached without a model lock
        [DataMember] public int BackstopAnswered;
        [DataMember] public int BackstopLocks;
        [DataMember] public int BackstopQuickUnlocks;
        [DataMember] public int HabitVerdicts;         // "likely gone" verdicts issued (shadow or live)
        [DataMember] public int HabitProbes;           // confirmation dims brought forward by habits
        [DataMember] public int HabitProbesAnswered;
        [DataMember] public int HabitLocks;
        [DataMember] public int HabitQuickUnlocks;
        [DataMember] public int Disconnects;           // RDP/console session disconnects (no label)
        [DataMember] public int AmbiguousScoredAway;   // learning: invisible decision in an ambiguous silence, judged "away" by the silence profile
        [DataMember] public int AmbiguousScoredUnknown;
        [DataMember] public int HousekeepingRuns;         // cleaning service runs (start + every 24 h)
        [DataMember] public long LastHousekeepingUtcTicks;
        [DataMember] public long JournalEpisodesRetired;  // cumulative
        [DataMember] public long FilesRetired;            // cumulative (crash leftovers, expired logs)
        [DataMember] public long LogLinesRetired;         // cumulative
        // Lock chain (a request is not a lock): requests, confirmations by the session-lock event or
        // a disconnect, refusals, retries, fallbacks, and requests the user overtook before any of it worked.
        [DataMember] public int LockRequests;
        [DataMember] public int LocksConfirmed;
        [DataMember] public int LockRefusals;
        [DataMember] public int LockRetries;
        [DataMember] public int LockFallbacks;
        [DataMember] public int LocksNeverConfirmed;
        // Labels: observed departures (Win+L, slow unlock after a lock) versus absence ASSUMED from
        // inactivity alone (learning mode, outside silent-work applications).
        [DataMember] public int ObservedDepartures;
        [DataMember] public int AssumedAbsenceLabels;
        // Collection to ProfileExportDirectory (review F22): success is recorded only after the file
        // was published completely; a failure retries after an hour, not a day.
        [DataMember] public long LastExportSuccessUtcTicks;
        [DataMember] public long LastExportAttemptUtcTicks;
        [DataMember] public int ExportFailures;
        // Signals the security loop depends on (review F14): degradations seen.
        [DataMember] public int IdleSignalFailures;
        [DataMember] public int RegistrationFailures;// ... not decidable: counted as a possible false dim (conservative)
        // Coverage (0.7.1, field profile 2026-11-13): which contexts the model actually sees, so that
        // "no silent-work app ever" or "this was a Remote Desktop session" is read from the profile
        // instead of guessed. Counts only, no names, no times.
        [DataMember] public int[] EpisodesByContext = new int[SilenceProfile.Contexts];   // neutral, silent-work, leaving
        [DataMember] public int RemoteEpisodes;        // episodes that started in a Remote Desktop session
        [DataMember] public int PostHoldEpisodes;      // episodes that started when a media/meeting hold ended
    }

    [DataContract]
    public sealed class UserProfile
    {
        /// <summary>v2: FeatureSchema.PostHold. v3: FeatureSchema.RemoteSession. Older profiles migrate on load.</summary>
        public const int CurrentSchemaVersion = 3;

        [DataMember] public int SchemaVersion = CurrentSchemaVersion;
        [DataMember] public string AppVersion = "0.7.1";
        [DataMember] public string UserSid = "";       // identity only, not content
        [DataMember] public string MachineName = "";
        /// <summary>
        /// Why this profile exists (0.7.1): "first start", "seeded from baseline", or "recreated: ..."
        /// when an earlier profile was missing or unusable. Empty in profiles written before 0.7.1.
        /// </summary>
        [DataMember] public string Origin = "";
        [DataMember] public long CreatedUtcTicks;
        [DataMember] public long UpdatedUtcTicks;

        [DataMember] public PresenceModel Model;
        [DataMember] public ModeController Modes;
        [DataMember] public EngineConfig Config;

        // Optional-sensor availability tracking (index aligned with FeatureSchema).
        [DataMember] public int[] OptionalSeen;       // episodes observed
        [DataMember] public int[] OptionalAvailable;  // of those, sensor produced a value

        [DataMember] public CoordinatorStats Stats;
        /// <summary>Learned per-activity silence lengths (decayed counters, no timestamps).</summary>
        [DataMember] public SilenceProfile Silence;
        /// <summary>Last model that proved itself, and the running live-vs-champion comparison.</summary>
        [DataMember] public ModelGuard Guard;
        /// <summary>Enforcing-mode quality check (false dims, unattended time at confirmed locks).</summary>
        [DataMember] public QualityMonitor Quality;
        /// <summary>User pauses of the last 24 h (budget); bounded, merged with the protected copy in NIS2 mode.</summary>
        [DataMember] public PauseLedger Pause;

        public UserProfile()
        {
            Model = new PresenceModel();
            Modes = new ModeController();
            Config = new EngineConfig();
            Stats = new CoordinatorStats();
            Silence = new SilenceProfile();
            Guard = new ModelGuard();
            Quality = new QualityMonitor();
            Pause = new PauseLedger();
            OptionalSeen = new int[FeatureSchema.Count];
            OptionalAvailable = new int[FeatureSchema.Count];
            CreatedUtcTicks = DateTime.UtcNow.Ticks;
            UpdatedUtcTicks = CreatedUtcTicks;
        }

        /// <summary>Which optional features are confirmed reliable enough to trust in enforcing mode.</summary>
        public bool[] ConfirmedOptionalMask()
        {
            var mask = new bool[FeatureSchema.Count];
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                if (!FeatureSchema.Optional[i]) { mask[i] = true; continue; }
                int seen = OptionalSeen[i];
                int avail = OptionalAvailable[i];
                bool enough = avail >= Config.MinSensorConfirmations;
                bool frac = seen > 0 && (avail / (double)seen) >= Config.SensorAvailabilityFraction;
                mask[i] = enough && frac;
            }
            return mask;
        }
    }
}
