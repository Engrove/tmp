using System;
using System.Linq;
using PresenceLock.Core;
using Xunit;

namespace PresenceLock.Core.Tests
{
    public class TamperProtectionTests
    {
        private const string Sid = "S-1-5-21-111-222-333-1001";

        // ---------------------------------------------------------------- process DACL

        [Fact]
        public void ProcessSddl_DeniesTerminateToUserAndOwner_GrantsFullOnlyToSystemAndAdmins()
        {
            string sddl = TamperProtection.AgentProcessSddl(Sid);
            Assert.StartsWith("D:P", sddl);                                    // protected, no inheritance
            Assert.Contains("(A;;0x1fffff;;;SY)", sddl);
            Assert.Contains("(A;;0x1fffff;;;BA)", sddl);
            Assert.Contains("(A;;0x101000;;;OW)", sddl);                       // strips implicit WRITE_DAC
            Assert.Contains("(A;;0x101000;;;" + Sid + ")", sddl);
            Assert.DoesNotContain("D;", sddl);                                 // no deny ACEs needed
            Assert.DoesNotContain(";GA;", sddl);                               // no generic rights
            const uint limited = 0x101000;
            Assert.Equal(0u, limited & TamperProtection.PROCESS_TERMINATE);
            Assert.Equal(4, sddl.Count(c => c == '('));
        }

        [Theory]
        [InlineData("")]
        [InlineData("Everyone")]
        [InlineData("S-1-5-21-1)(A;;0x1fffff;;;WD")]                         // SDDL injection attempt
        public void ProcessSddl_RejectsNonSidInput(string bad) =>
            Assert.Throws<ArgumentException>(() => TamperProtection.AgentProcessSddl(bad));

        // ---------------------------------------------------------------- profile file tampering

        private static UserProfile Profile(OperatingMode mode, long firstSeen)
        {
            var p = new UserProfile { UserSid = Sid };
            p.Modes.Mode = mode;
            p.Modes.FirstSeenUtcTicks = firstSeen;
            return p;
        }

        [Fact]
        public void ResetPolicyFields_UndoesEveryPolicyEdit_KeepsLearnedState()
        {
            var p = Profile(OperatingMode.Enforcing, 100);
            p.Model.W[3] = 1.25;
            p.Modes.ConfirmedPositives = 77;
            // a user's edits to the JSON:
            p.Config.LockThreshold = 2.0; p.Config.SoftDimThreshold = 2.0;
            p.Config.LongAbsenceSeconds = 1_000_000; p.Config.FalsePositiveWindowSeconds = 100000;
            p.Modes.MinLearningDays = 100000; p.Modes.TargetFalsePositiveRate = 0.0;
            p.Model.LearningRate = 0.0; p.Model.RateParamClip = -50;

            TamperProtection.ResetPolicyFields(p);

            var d = new UserProfile();
            Assert.Equal(d.Config.LockThreshold, p.Config.LockThreshold);
            Assert.Equal(d.Config.SoftDimThreshold, p.Config.SoftDimThreshold);
            Assert.Equal(d.Config.LongAbsenceSeconds, p.Config.LongAbsenceSeconds);
            Assert.Equal(d.Config.FalsePositiveWindowSeconds, p.Config.FalsePositiveWindowSeconds);
            Assert.Equal(d.Modes.MinLearningDays, p.Modes.MinLearningDays);
            Assert.Equal(d.Modes.TargetFalsePositiveRate, p.Modes.TargetFalsePositiveRate);
            Assert.Equal(d.Model.LearningRate, p.Model.LearningRate);
            Assert.Equal(d.Model.RateParamClip, p.Model.RateParamClip);
            Assert.Equal(1.25, p.Model.W[3]);                                  // learned weight kept
            Assert.Equal(77, p.Modes.ConfirmedPositives);
            Assert.Equal(OperatingMode.Enforcing, p.Modes.Mode);
        }

        [Fact]
        public void ResetPolicyFields_ReplacesNonFiniteWeights()
        {
            var p = Profile(OperatingMode.Enforcing, 100);
            p.Model.W0 = double.NaN;
            TamperProtection.ResetPolicyFields(p);
            Assert.Equal(PresenceModel.DefaultW0, p.Model.W0);
        }

        [Fact]
        public void ChooseTrusted_RestoresDeletedProfile()
        {
            var prot = Profile(OperatingMode.Enforcing, 100);
            var fresh = Profile(OperatingMode.Learning, 0);
            var chosen = TamperProtection.ChooseTrusted(fresh, false, prot, Sid, ModePolicy.Auto, out var why);
            Assert.Same(prot, chosen);
            Assert.Contains("missing", why);
        }

        [Fact]
        public void ChooseTrusted_RestoresModeDemotion()
        {
            var prot = Profile(OperatingMode.Enforcing, 100);
            var edited = Profile(OperatingMode.Learning, 100);
            Assert.Same(prot, TamperProtection.ChooseTrusted(edited, true, prot, Sid, ModePolicy.Auto, out _));
        }

        [Fact]
        public void ChooseTrusted_RestoresRestartedLearningClock()
        {
            var prot = Profile(OperatingMode.Learning, 100);
            var edited = Profile(OperatingMode.Learning, 900);
            Assert.Same(prot, TamperProtection.ChooseTrusted(edited, true, prot, Sid, ModePolicy.Auto, out _));
        }

        [Fact]
        public void ChooseTrusted_KeepsHealthyLocal_AndHonoursAdminForceLearning()
        {
            var prot = Profile(OperatingMode.Learning, 100);
            var local = Profile(OperatingMode.Enforcing, 100);                 // progressed since last copy
            Assert.Same(local, TamperProtection.ChooseTrusted(local, true, prot, Sid, ModePolicy.Auto, out _));

            var prot2 = Profile(OperatingMode.Enforcing, 100);
            var local2 = Profile(OperatingMode.Learning, 100);
            Assert.Same(local2, TamperProtection.ChooseTrusted(local2, true, prot2, Sid, ModePolicy.ForceLearning, out _));
        }

        [Fact]
        public void ChooseTrusted_IgnoresAnotherUsersCopy()
        {
            var prot = Profile(OperatingMode.Enforcing, 100);
            prot.UserSid = "S-1-5-21-9-9-9-500";
            var local = Profile(OperatingMode.Learning, 0);
            Assert.Same(local, TamperProtection.ChooseTrusted(local, false, prot, Sid, ModePolicy.Auto, out _));
        }

        [Fact]
        public void AcceptIntoProtected_IsMonotonic()
        {
            var existing = Profile(OperatingMode.Enforcing, 100);
            Assert.False(TamperProtection.AcceptIntoProtected(existing, Profile(OperatingMode.Learning, 100), Sid, ModePolicy.Auto, out _));
            Assert.False(TamperProtection.AcceptIntoProtected(existing, Profile(OperatingMode.Enforcing, 500), Sid, ModePolicy.Auto, out _));
            Assert.True(TamperProtection.AcceptIntoProtected(existing, Profile(OperatingMode.Enforcing, 100), Sid, ModePolicy.Auto, out _));
            Assert.True(TamperProtection.AcceptIntoProtected(existing, Profile(OperatingMode.Learning, 100), Sid, ModePolicy.ForceLearning, out _));
            var foreign = Profile(OperatingMode.Enforcing, 100); foreign.UserSid = "S-1-5-21-1-1-1-1";
            Assert.False(TamperProtection.AcceptIntoProtected(null, foreign, Sid, ModePolicy.Auto, out _));
            Assert.True(TamperProtection.AcceptIntoProtected(null, Profile(OperatingMode.Learning, 100), Sid, ModePolicy.Auto, out _));
        }

        // ---------------------------------------------------------------- guard service

        private static SessionSnapshot S(int id, bool running, bool active = true) =>
            new SessionSnapshot { SessionId = id, Active = active, AgentRunning = running };

        [Fact]
        public void Guard_StartsAgentAtLogon_WithoutLocking()
        {
            var g = new GuardPolicy();
            g.OnLogon(2);
            Assert.Empty(g.Evaluate(new[] { S(2, false) }, failClosed: true));          // 1st miss
            var a = g.Evaluate(new[] { S(2, false) }, failClosed: true);                // 2nd miss
            Assert.Equal(new[] { "StartAgent@2" }, a.Select(x => x.ToString()));
        }

        [Fact]
        public void Guard_KilledAgent_LocksSessionAndRestarts()
        {
            var g = new GuardPolicy();
            g.Evaluate(new[] { S(2, true) }, true);
            g.Evaluate(new[] { S(2, false) }, true);
            var a = g.Evaluate(new[] { S(2, false) }, true);
            Assert.Equal(new[] { "LockSession@2", "StartAgent@2" }, a.Select(x => x.ToString()));
        }

        [Fact]
        public void Guard_FailOpenPolicy_RestartsWithoutLocking()
        {
            var g = new GuardPolicy();
            g.Evaluate(new[] { S(2, true) }, false);
            g.Evaluate(new[] { S(2, false) }, false);
            Assert.Equal(new[] { "StartAgent@2" }, g.Evaluate(new[] { S(2, false) }, false).Select(x => x.ToString()));
        }

        [Fact]
        public void Guard_AlreadyLockedSession_IsNotLockedAgain()
        {
            var g = new GuardPolicy();
            g.Evaluate(new[] { S(2, true) }, true);
            g.OnLock(2);
            g.Evaluate(new[] { S(2, false) }, true);
            Assert.Equal(new[] { "StartAgent@2" }, g.Evaluate(new[] { S(2, false) }, true).Select(x => x.ToString()));
        }

        [Fact]
        public void Guard_RepeatedKills_LockAgainAfterEachUnlock()
        {
            var g = new GuardPolicy();
            for (int round = 0; round < 3; round++)
            {
                g.Evaluate(new[] { S(2, true) }, true);
                g.Evaluate(new[] { S(2, false) }, true);
                var a = g.Evaluate(new[] { S(2, false) }, true);
                Assert.Contains(a, x => x.Kind == GuardActionKind.LockSession);
                g.OnUnlock(2);
            }
        }

        [Fact]
        public void Guard_IgnoresLogoff_DisconnectedSessions_AndSessionZero()
        {
            var g = new GuardPolicy();
            g.Evaluate(new[] { S(2, true), S(3, true) }, true);
            g.OnLogoff(2);
            for (int i = 0; i < 3; i++)
                Assert.Empty(g.Evaluate(new[] { S(0, false), S(2, false), S(3, false, active: false) }, true));
        }

        [Fact]
        public void Guard_ForgetsEndedSessions()
        {
            var g = new GuardPolicy();
            g.Evaluate(new[] { S(5, true) }, true);
            g.Evaluate(new SessionSnapshot[0], true);                                    // session 5 gone
            g.Evaluate(new[] { S(5, false) }, true);                                     // new session reusing id 5
            var a = g.Evaluate(new[] { S(5, false) }, true);
            Assert.Equal(new[] { "StartAgent@5" }, a.Select(x => x.ToString()));         // no lock: never seen
        }
    }
}
