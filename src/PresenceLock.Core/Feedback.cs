namespace PresenceLock.Core
{
    /// <summary>
    /// How a stored decision snapshot was labelled by subsequent ground truth.
    /// This is the "free label" that makes the loop self-supervised: the user's own
    /// behaviour supplies the correct answer within minutes, no prompting required.
    /// </summary>
    public enum FeedbackKind
    {
        /// <summary>
        /// We predicted "away" (soft-dim or lock) and the user re-asserted presence
        /// almost immediately (nudged during dim, or unlocked within the FP window).
        /// Label y = 0 (present). Pushes P down for this context.
        /// </summary>
        FalsePositive,

        /// <summary>
        /// The user pressed Win+L themselves. The 5 s pre-lock signature is a perfect
        /// positive example. Label y = 1 (away), high weight. This is the primary
        /// teacher during the first days.
        /// </summary>
        ManualLock,

        /// <summary>
        /// Input was absent far beyond any plausible pause (default &gt;180 s). We know
        /// the user was away AT THAT idle time — not when they left. Label y = 1 at the
        /// observed idle time (a censored observation). Deliberately NOT back-dated to t0:
        /// the user may have sat reading for minutes before leaving.
        /// Also used for a confirmed-correct enforced lock (labelled at decision time,
        /// which is valid there because the visible soft-dim went unanswered).
        /// </summary>
        LongAbsence,

        /// <summary>
        /// A soft-dim fired and the user corrected it by a 1 mm nudge. Same sign as
        /// FalsePositive (y = 0) but logged separately for calibration metrics.
        /// </summary>
        SoftDimRejected,

        /// <summary>
        /// Learning mode, "Visa låsning" enabled: the user clicked the notice to say the
        /// would-be lock was unjustified. Label y = 0 at decision time, high weight.
        /// </summary>
        UserFlaggedUnjustified
    }

    /// <summary>One labelled training example: the stored signature plus its truth.</summary>
    public sealed class FeedbackSample
    {
        public FeatureVector Features;
        public double Label;        // y in {0,1}
        public double Weight;       // importance weight
        public FeedbackKind Kind;
        public long TimestampUtcTicks;

        public static FeedbackSample From(FeatureVector f, FeedbackKind kind, long utcTicks)
        {
            double y, w;
            switch (kind)
            {
                case FeedbackKind.ManualLock:      y = 1.0; w = 2.0; break;
                case FeedbackKind.LongAbsence:     y = 1.0; w = 1.5; break;
                case FeedbackKind.FalsePositive:   y = 0.0; w = 1.0; break;
                case FeedbackKind.SoftDimRejected: y = 0.0; w = 1.0; break;
                case FeedbackKind.UserFlaggedUnjustified: y = 0.0; w = 2.0; break;
                default:                           y = 0.0; w = 1.0; break;
            }
            return new FeedbackSample
            {
                Features = f, Label = y, Weight = w, Kind = kind, TimestampUtcTicks = utcTicks
            };
        }
    }
}
