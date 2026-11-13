using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// Regression tests for the external review of 0.6.1 (2026-11-12, "Djupgranskning").
    /// Each T-case reproduced a defect in the shipped binary; here the same scenario must show the
    /// CORRECTED behaviour. C01/C02 were positive controls and must stay green.
    /// </summary>
    public class ReviewFindingsTests
    {
        private readonly ITestOutputHelper _out;
        public ReviewFindingsTests(ITestOutputHelper o) { _out = o; }
        private static readonly long T0 = new DateTime(2026, 11, 12, 8, 0, 0, DateTimeKind.Utc).Ticks;
        private const long Sec = TimeSpan.TicksPerSecond;
        private static FeatureVector Sig() => new FeatureVector();

        private static (UserProfile p, PresenceCoordinator c) New(bool slow = false)
        {
            var p = new UserProfile { UserSid = "S-1-5-21-100-200-300-1001", MachineName = "REVIEW" };
            p.Modes.Mode = OperatingMode.Enforcing;
            if (slow) { p.Model.W0 = -100; p.Model.U0 = -30; Array.Clear(p.Model.W, 0, p.Model.W.Length); Array.Clear(p.Model.U, 0, p.Model.U.Length); }
            return (p, new PresenceCoordinator(new PresenceEngine(p), new CoordinatorConfig { ModelGuard = null }));
        }

        private static CoordinatorResult Tick(PresenceCoordinator c, double seconds, double idle) =>
            c.Tick(T0 + (long)(seconds * Sec), idle, default(PassiveSignals), ModePolicy.Auto, Sig);

        private static bool IsSecuring(CoordinatorAction a) => a == CoordinatorAction.Lock || a == CoordinatorAction.Disconnect;

        /// <summary>F01 / T01: every refused request is retried while the user stays away, and the
        /// fallback (disconnect) is requested within the documented bound.</summary>
        [Fact]
        public void T01_RefusedLock_IsRetried_AndFallsBackWithinTheBound()
        {
            var (p, c) = New();
            var requests = new List<(int s, CoordinatorAction a)>();
            for (int i = 0; i <= 2000; i++)
            {
                var r = Tick(c, i, i);
                if (IsSecuring(r.Action)) { requests.Add((i, r.Action)); c.OnLockRefused(); }
            }
            _out.WriteLine(string.Join(", ", requests.Take(8).Select(x => x.a + "@" + x.s)) + $" ... ({requests.Count} requests)");
            Assert.Equal(48, requests[0].s);
            int firstFallback = requests.First(x => x.a == CoordinatorAction.Disconnect).s;
            Assert.True(firstFallback <= 915, $"fallback at {firstFallback} s");
            Assert.All(requests.Zip(requests.Skip(1), (a, b) => b.s - a.s), gap => Assert.True(gap <= 16));   // never gives up
            Assert.True(p.Stats.LockRefusals >= requests.Count - 1);
        }

        /// <summary>F01 / T02: no session-lock event after the request = not locked: request again.</summary>
        [Fact]
        public void T02_UnacknowledgedLock_IsRequestedAgain_ThenFallsBack()
        {
            var (p, c) = New();
            var requests = new List<(int s, CoordinatorAction a, bool retry)>();
            for (int i = 0; i <= 200; i++) { var r = Tick(c, i, i); if (IsSecuring(r.Action)) requests.Add((i, r.Action, r.LockUnconfirmed)); }
            _out.WriteLine(string.Join(", ", requests.Select(x => x.a + "@" + x.s)));
            Assert.Equal(new[] { 48, 58, 68, 78 }, requests.Take(4).Select(x => x.s).ToArray());
            Assert.Equal(CoordinatorAction.Disconnect, requests[3].a);
            Assert.True(requests.Skip(1).All(x => x.retry));
            // the session-lock event confirms it: no further requests
            c.OnSessionLocked(T0 + 201 * Sec, 201, Sig);
            Assert.Equal(1, p.Stats.LocksConfirmed);
        }

        /// <summary>F15 / T03: a backstop lock unlocked within seconds is a wrong decision, exactly like a model lock.</summary>
        [Fact]
        public void T03_BackstopLock_QuickUnlock_IsScoredAsWrong()
        {
            var (p, c) = New(true);
            int at = -1;
            for (int i = 0; i < 1000; i++) if (Tick(c, i, i).Action == CoordinatorAction.Lock) { at = i; break; }
            c.OnSessionLocked(T0 + at * Sec, at, Sig);
            c.OnSessionUnlocked(T0 + (at + 5) * Sec);
            _out.WriteLine($"lock at {at} s, unlock 5 s later: positives {p.Modes.ConfirmedPositives}, false positives {p.Modes.WindowFalsePositives()}");
            Assert.Equal(0, p.Modes.ConfirmedPositives);
            Assert.Equal(1, p.Modes.WindowFalsePositives());
            p.Modes.WindowDecisions(out _, out int wrong, out _);
            Assert.Equal(1, wrong);
        }

        /// <summary>F06 / T04: input between two ticks (idle already 1.2 s at the next one) cancels the confirmation.</summary>
        [Fact]
        public void T04_InputDuringConfirmation_IsSeen_EvenWhenTheTickIsLate()
        {
            var (p, c) = New(true);
            Tick(c, 0, 0);
            var dim = Tick(c, 600, 600);
            var after = Tick(c, 615, 1.2);
            Assert.Equal(CoordinatorAction.SoftDim, dim.Action);
            Assert.NotEqual(CoordinatorAction.Lock, after.Action);
            Assert.Equal(1, p.Stats.BackstopAnswered);
        }

        /// <summary>F02 / T05: the guard keeps requesting until Windows reports the lock, then disconnects.</summary>
        [Fact]
        public void T05_GuardLockRequest_IsNotAConfirmation()
        {
            var guard = new GuardPolicy();
            var snap = new[] { new SessionSnapshot { SessionId = 1, Active = true, AgentRunning = true, HeartbeatAgeSeconds = 1 } };
            guard.Evaluate(snap, true);
            snap[0].AgentRunning = false; snap[0].HeartbeatAgeSeconds = double.NaN;
            var actions = new List<GuardAction>();
            for (int i = 0; i < 20; i++) actions.AddRange(guard.Evaluate(snap, true));
            var locks = actions.Where(a => a.Kind != GuardActionKind.StartAgent).ToList();
            _out.WriteLine(string.Join(", ", locks.Select(a => a.Kind + "#" + a.Attempt)));
            Assert.True(locks.Count >= 4);
            Assert.Contains(locks, a => a.Kind == GuardActionKind.DisconnectSession);
            Assert.True(actions.Count(a => a.Kind == GuardActionKind.StartAgent) <= 2);   // rate-limited
            // Windows reports the session locked: requests stop.
            snap[0].Locked = true;
            Assert.DoesNotContain(guard.Evaluate(snap, true), a => a.Kind != GuardActionKind.StartAgent);
        }

        /// <summary>F02 / T06: an agent that never becomes healthy after logon is fail-closed too.</summary>
        [Fact]
        public void T06_GuardColdStart_NoHealthyAgent_IsLockedAfterTheGrace()
        {
            var guard = new GuardPolicy();
            var snap = new[] { new SessionSnapshot { SessionId = 1, Active = true, AgentRunning = false, HeartbeatAgeSeconds = double.NaN } };
            int firstLockPoll = -1;
            for (int i = 0; i < 100 && firstLockPoll < 0; i++)
                if (guard.Evaluate(snap, true).Any(a => a.Kind == GuardActionKind.LockSession)) firstLockPoll = i;
            _out.WriteLine($"first lock request at poll {firstLockPoll} ({firstLockPoll * 2} s)");
            Assert.InRange(firstLockPoll, guard.ColdStartGracePolls - 1, guard.ColdStartGracePolls + guard.MissesBeforeAction);
        }

        /// <summary>F04: a process that exists but stops its heartbeat (hung) is not healthy.</summary>
        [Fact]
        public void F04_HungAgent_WithStaleHeartbeat_IsTreatedAsMissing()
        {
            var guard = new GuardPolicy();
            var snap = new[] { new SessionSnapshot { SessionId = 1, Active = true, AgentRunning = true, HeartbeatAgeSeconds = 1 } };
            guard.Evaluate(snap, true);
            snap[0].HeartbeatAgeSeconds = 120;   // process still there, heartbeat stale
            var actions = new List<GuardAction>();
            for (int i = 0; i < 40; i++) actions.AddRange(guard.Evaluate(snap, true));
            Assert.Contains(actions, a => a.Kind == GuardActionKind.LockSession && a.Reason == "agent not responding");
            Assert.DoesNotContain(actions, a => a.Kind == GuardActionKind.StartAgent);   // it is running: do not start a second one
        }

        /// <summary>F03 / T07: protection-relevant values cannot come from the user's own policy hive.</summary>
        [Fact]
        public void T07_UserScopePolicy_CannotCarryProtectionSettings()
        {
            foreach (var name in new[] { "ModePolicy", "AllowUserExit", "HoldMaxMinutes", "PauseKeepsConfirmation", "PauseBudgetMinutesPerDay",
                                         "MaxLearnedHorizonMinutes", "ExtraReadingApps", "ProfileExportDirectory", "TargetFalsePositivePercent", "LogRetentionDays" })
                Assert.False(PolicyScope.IsUserSettable(name), name);
            Assert.True(PolicyScope.IsUserSettable("ShowLockNotification"));
            Assert.Single(PolicyScope.UserSettableNames);
        }

        /// <summary>F10 / T08: a forged year-long pause never reaches the protected copy or the coordinator.</summary>
        [Fact]
        public void T08_ForgedYearLongPause_IsDropped()
        {
            var (p, c) = New();
            var old = ProfileStore.Deserialize(ProfileStore.Serialize(p));
            p.Pause.Intervals.Add(new PauseLedger.Interval { StartUtcTicks = T0, ChargedEndUtcTicks = T0 + 365L * TimeSpan.TicksPerDay });
            Assert.True(TamperProtection.AcceptIntoProtected(old, p, p.UserSid, ModePolicy.Auto, out _));
            Assert.Empty(p.Pause.Intervals);                                     // sanitised on the way in
            var loaded = ProfileStore.Deserialize(ProfileStore.Serialize(p)); TamperProtection.ResetPolicyFields(loaded);
            var forged = new PresenceCoordinator(new PresenceEngine(loaded), new CoordinatorConfig());
            Assert.False(forged.PauseActive(T0 + TimeSpan.TicksPerHour));
            // and a pause longer than the policy's longest option is not honoured either
            var q = new UserProfile();
            q.Pause.Intervals.Add(new PauseLedger.Interval { StartUtcTicks = T0, ChargedEndUtcTicks = T0 + 300 * TimeSpan.TicksPerMinute });
            var co = new PresenceCoordinator(new PresenceEngine(q), new CoordinatorConfig());   // options 30/60/90
            Assert.False(co.PauseActive(T0 + TimeSpan.TicksPerMinute));
        }

        /// <summary>F11 / T09: a missing profile with a good backup is restored, with a notice.</summary>
        [Fact]
        public void T09_MissingProfile_IsRestoredFromTheBackup()
        {
            string dir = Path.Combine(Path.GetTempPath(), "pl-t09-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                string path = Path.Combine(dir, "profile.json");
                var backup = new UserProfile { UserSid = "S-1-5-21-1" }; backup.Modes.Mode = OperatingMode.Enforcing;
                ProfileStore.Save(path + ".bak", backup);
                var recovered = ProfileStore.LoadWithRecovery(path, "S-1-5-21-1", "PC", out string recovery);
                Assert.Equal(OperatingMode.Enforcing, recovered.Modes.Mode);
                Assert.Contains("missing", recovery);
                // a backup of ANOTHER user is not used
                var other = ProfileStore.LoadWithRecovery(path, "S-1-5-21-2", "PC", out string r2);
                Assert.Equal(OperatingMode.Learning, other.Modes.Mode);
                Assert.Contains("no usable backup", r2);
            }
            finally { Directory.Delete(dir, true); }
        }

        /// <summary>F13 / T10: a mouse gesture older than the last input (keyboard work since) is not reused.</summary>
        [Fact]
        public void T10_StaleMouseGesture_IsNotWrittenIntoALaterEpisode()
        {
            var k = new KinematicsTracker();
            k.Feed(new RawInputSample { Dx = 80, TimestampTicks = T0 });
            k.Feed(new RawInputSample { Dx = 50, TimestampTicks = T0 + Sec / 10 });
            var fresh = Sig(); var stale = Sig();
            k.WriteFeatures(fresh, 1919, 500, 0, 0, 1920, 1080, nowTicks: T0 + 3 * Sec, idleSeconds: 2.9);    // mouse stopped 2.9 s ago
            k.WriteFeatures(stale, 1919, 500, 0, 0, 1920, 1080, nowTicks: T0 + 600 * Sec, idleSeconds: 3);    // typed until 3 s ago
            Assert.Contains(fresh.X, x => x > 0);
            Assert.True(stale.X.All(x => x == 0));
        }

        /// <summary>F07 / T11: the confirmation runs on the idle axis; a clock step back does not delay the lock.</summary>
        [Fact]
        public void T11_ClockStepBack_DoesNotDelayTheLock()
        {
            var (p, c) = New(true);
            Tick(c, 0, 0);
            var dim = Tick(c, 600, 600);
            var delayed = Tick(c, -3000, 1000);
            Assert.Equal(CoordinatorAction.SoftDim, dim.Action);
            Assert.Equal(CoordinatorAction.Lock, delayed.Action);
        }

        /// <summary>F21 / T12: the collected profile carries no identity and no life-cycle times.</summary>
        [Fact]
        public void T12_Collection_HasNoIdentityOrLifecycleTimes()
        {
            var p = new UserProfile { UserSid = "S-1-5-21-9", MachineName = "PC9", CreatedUtcTicks = T0, UpdatedUtcTicks = T0 + 5 * TimeSpan.TicksPerHour };
            p.Modes.FirstSeenUtcTicks = T0 + 2 * Sec; p.Modes.PromotedUtcTicks = T0 + 3 * Sec;
            var c = ProfileStore.ExportForCollection(p);
            Assert.Equal("", c.UserSid);
            Assert.Equal("", c.MachineName);
            Assert.Equal(0, c.CreatedUtcTicks);
            Assert.Equal(0, c.Modes.FirstSeenUtcTicks);
            Assert.Equal(0, c.Modes.PromotedUtcTicks);
            Assert.Equal(0, c.UpdatedUtcTicks % TimeSpan.TicksPerDay);                // day only
        }

        /// <summary>F17 / T13: ten fires, all wrong, must not pass the gate even though it is 5 % per episode.</summary>
        [Fact]
        public void T13_AllDecisionsWrong_DoesNotPassTheGate()
        {
            var p = new UserProfile(); p.Modes.FirstSeenUtcTicks = T0 - 30L * TimeSpan.TicksPerDay; p.Modes.ConfirmedPositives = 30;
            for (int i = 0; i < 200; i++) p.Modes.RecordEpisodeOutcome(i < 10, i < 10);
            p.Modes.Evaluate(T0, ModePolicy.Auto);
            _out.WriteLine(p.Modes.Explain(T0));
            Assert.Equal(OperatingMode.Learning, p.Modes.Mode);
            Assert.True(p.Modes.FalsePositiveUpperBound() <= 0.10);                   // per-episode criterion alone would pass
            // ten fires of which one is wrong: passes
            var q = new UserProfile(); q.Modes.FirstSeenUtcTicks = T0 - 30L * TimeSpan.TicksPerDay; q.Modes.ConfirmedPositives = 30;
            for (int i = 0; i < 200; i++) q.Modes.RecordEpisodeOutcome(i < 10, i < 1);
            q.Modes.Evaluate(T0, ModePolicy.Auto);
            Assert.Equal(OperatingMode.Enforcing, q.Modes.Mode);
        }

        /// <summary>F16 / T14: a long silence in a reading app is not assumed to be absence.</summary>
        [Fact]
        public void T14_LongReading_IsNotAssumedAbsent()
        {
            var learning = new UserProfile();
            var co = new PresenceCoordinator(new PresenceEngine(learning), new CoordinatorConfig { ModelGuard = null });
            var reading = new FeatureVector(); reading.X[FeatureSchema.CtxReading] = 1;
            for (int i = 0; i <= 3600; i++) co.Tick(T0 + i * Sec, i, default(PassiveSignals), ModePolicy.ForceLearning, () => reading);
            Assert.Equal(0, learning.Modes.ConfirmedPositives);
            Assert.Equal(0, learning.Stats.AssumedAbsenceLabels);
        }

        [Fact]
        public void C01_NominalModelPath_Unchanged()
        {
            var (_, c) = New();
            var events = new List<string>();
            for (int i = 0; i < 100; i++) { var a = Tick(c, i, i); if (a.Action != CoordinatorAction.None) events.Add(a.Action + "@" + i); if (a.Action == CoordinatorAction.Lock) break; }
            Assert.Equal(new[] { "SoftDim@38", "Lock@48" }, events);
        }

        [Fact]
        public void C02_DeletedPauseCharges_RestoredByUnion()
        {
            var merged = new PauseLedger(); merged.TryStart(30, T0, new PausePolicy(), out _);
            var empty = new PauseLedger(); empty.MergeFrom(merged);
            Assert.Equal(30, empty.ChargedMinutes(T0), 6);
        }

        /// <summary>F01: the safety floor holds without a model episode (e.g. after mode changed mid-idle).</summary>
        [Fact]
        public void F01_SafetyFloor_NoEpisode_StillConfirmsAtHoldMax()
        {
            var p = new UserProfile();
            var co = new PresenceCoordinator(new PresenceEngine(p), new CoordinatorConfig { ModelGuard = null });
            var reading = new FeatureVector(); reading.X[FeatureSchema.CtxReading] = 1;
            for (int i = 0; i <= 400; i++) co.Tick(T0 + i * Sec, i, default(PassiveSignals), ModePolicy.ForceLearning, () => reading);
            co.Engine.AbortEpisode();                             // no episode, idle keeps growing
            int lockAt = -1;
            for (int i = 401; i <= 2000 && lockAt < 0; i++)
                if (co.Tick(T0 + i * Sec, i, default(PassiveSignals), ModePolicy.ForceEnforcing, () => reading).Action == CoordinatorAction.Lock) lockAt = i;
            Assert.InRange(lockAt, 900, 900 + 15 + 1);
        }

        /// <summary>F01: the user returning before the lock was ever confirmed ends the request and counts as exposure.</summary>
        [Fact]
        public void F01_UserBackBeforeConfirmation_EndsTheRequest_AndIsCounted()
        {
            var (p, c) = New();
            for (int i = 0; i <= 50; i++) Tick(c, i, i);          // lock requested at 48, never confirmed
            Tick(c, 51, 0.2);                                     // user back
            Assert.Equal(1, p.Stats.LocksNeverConfirmed);
            Assert.Equal(LockCause.None, c.PendingLock);
            Assert.True(p.Quality.ExposureCount == 1);
        }
    }
}
