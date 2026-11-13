using System;
using System.IO;
using System.Text.RegularExpressions;
using PresenceLock.Core;
using Xunit;

namespace PresenceLock.Core.Tests
{
    public class ProfileStoreTests
    {
        private static UserProfile Trained()
        {
            var res = UserSim.Run(days: 20, seed: 5, ambiguous: false);
            var p = res.Engine.Profile;
            p.UserSid = "S-1-5-21-1-2-3-1001";
            p.MachineName = "WS-TEST";
            return p;
        }

        [Fact]
        public void RoundTrip_PreservesEverythingThatMatters()
        {
            var p = Trained();
            var q = ProfileStore.Deserialize(ProfileStore.Serialize(p));
            Assert.Equal(p.Model.W0, q.Model.W0);
            Assert.Equal(p.Model.U0, q.Model.U0);
            Assert.Equal(p.Model.W, q.Model.W);
            Assert.Equal(p.Model.U, q.Model.U);
            Assert.Equal(p.Modes.Mode, q.Modes.Mode);
            Assert.Equal(p.Modes.FireWindow, q.Modes.FireWindow);
            Assert.Equal(p.Modes.DayWindow, q.Modes.DayWindow);
            Assert.Equal(p.Modes.WindowHead, q.Modes.WindowHead);
            Assert.Equal(p.Modes.WindowCount, q.Modes.WindowCount);
            Assert.Equal(p.Modes.WindowFalsePositives(), q.Modes.WindowFalsePositives());
            Assert.Equal(p.Modes.ConfirmedPositives, q.Modes.ConfirmedPositives);
            Assert.Equal(p.UserSid, q.UserSid);
            Assert.Equal(p.Config.LockThreshold, q.Config.LockThreshold);
        }

        [Fact]
        public void Json_ContainsNoContent_OnlyWeightsAndCounters()
        {
            string json = ProfileStore.Serialize(Trained());
            // Nothing that could be a window title, path, key code or audio buffer.
            Assert.DoesNotContain("Title", json);
            Assert.DoesNotContain("Key", json);
            Assert.DoesNotContain("Audio\":[", json);
            Assert.True(json.Length < 20000, $"profile unexpectedly large: {json.Length} bytes");
        }

        [Fact]
        public void SaveAndLoad_OnDisk()
        {
            string dir = Path.Combine(Path.GetTempPath(), "pl-test-" + Guid.NewGuid().ToString("N"));
            string path = Path.Combine(dir, "profile.json");
            try
            {
                var p = Trained();
                ProfileStore.Save(path, p);
                ProfileStore.Save(path, p);                     // second save exercises File.Replace
                var q = ProfileStore.LoadOrCreate(path, "ignored", "ignored");
                Assert.Equal(p.Model.W, q.Model.W);
                Assert.Equal(p.UserSid, q.UserSid);
                Assert.False(File.Exists(path + ".tmp"));
            }
            finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
        }

        [Fact]
        public void CorruptFile_FallsBackToFreshProfile_NeverThrows()
        {
            string dir = Path.Combine(Path.GetTempPath(), "pl-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "profile.json");
            try
            {
                File.WriteAllText(path, "{ this is not json");
                var p = ProfileStore.LoadOrCreate(path, "S-1", "PC");
                Assert.Equal("S-1", p.UserSid);
                Assert.Equal(PresenceModel.DefaultW0, p.Model.W0);
            }
            finally { Directory.Delete(dir, true); }
        }

        [Fact]
        public void MissingWindowInOldJson_IsRepaired()
        {
            string json = ProfileStore.Serialize(Trained());
            json = Regex.Replace(json, "\"FireWindow\":\\[[^\\]]*\\],?", "");
            var q = ProfileStore.Deserialize(json);
            Assert.Equal(ModeController.WindowCapacity, q.Modes.FireWindow.Length);
            Assert.Equal(0, q.Modes.WindowCount);
        }

        /// <summary>
        /// 0.7.1: a window recorded under the old rule counted every 2-s typing pause (field profile
        /// 2026-11-13). It is discarded on load; everything learned is kept.
        /// </summary>
        [Fact]
        public void WindowFromAnOlderRule_IsDiscarded_LearningIsKept()
        {
            var p = Trained();
            for (int i = 0; i < 50; i++) p.Modes.RecordEpisodeOutcome(i % 10 == 0, i % 10 == 0, 60, UserSim.BaseTicks + i * TimeSpan.TicksPerHour);
            p.Modes.RecordConfirmedPositive();
            string json = ProfileStore.Serialize(p);
            Assert.Contains(",\"WindowRule\":2", json);
            json = json.Replace(",\"WindowRule\":2", "");                                       // as written by 0.7.0
            json = json.Replace("\"PromotedUtcTicks\":", "\"OutcomeWindow\":[false,true],\"PromotedUtcTicks\":");  // 0.7.0 member, ignored
            var q = ProfileStore.Deserialize(json);
            Assert.Equal(0, q.Modes.WindowCount);
            Assert.Equal(1, q.Modes.WindowResets);
            Assert.Equal(ModeController.CurrentWindowRule, q.Modes.WindowRule);
            Assert.Equal(p.Modes.ConfirmedPositives, q.Modes.ConfirmedPositives);
            Assert.Equal(p.Modes.FiredDecisions, q.Modes.FiredDecisions);
            Assert.Equal(p.Model.W, q.Model.W);
            Assert.Equal(p.Model.U0, q.Model.U0);
            var r = ProfileStore.Deserialize(ProfileStore.Serialize(q));             // and it stays migrated
            Assert.Equal(1, r.Modes.WindowResets);
        }

        [Fact]
        public void SchemaV1Profile_IsMigrated_KeepingEveryLearnedWeight()
        {
            var v1 = Trained();
            v1.SchemaVersion = 1;
            var w11 = new double[11]; var u11 = new double[11];
            for (int i = 0; i < 11; i++) { w11[i] = v1.Model.W[i]; u11[i] = v1.Model.U[i]; }
            v1.Model.W = w11; v1.Model.U = u11;
            v1.OptionalSeen = new int[11]; v1.OptionalAvailable = new int[11];
            v1.OptionalSeen[9] = 7;
            v1.Stats = null;                                   // v1 had no stats

            var v2 = ProfileStore.Deserialize(ProfileStore.Serialize(v1));

            Assert.Equal(UserProfile.CurrentSchemaVersion, v2.SchemaVersion);
            Assert.Equal(FeatureSchema.Count, v2.Model.W.Length);
            for (int i = 0; i < 11; i++) { Assert.Equal(w11[i], v2.Model.W[i]); Assert.Equal(u11[i], v2.Model.U[i]); }
            Assert.Equal(0.0, v2.Model.W[FeatureSchema.PostHold]);
            Assert.Equal(7, v2.OptionalSeen[9]);
            Assert.NotNull(v2.Stats);
            Assert.Equal(v1.Modes.WindowCount, v2.Modes.WindowCount);   // same window rule: kept
        }

        [Fact]
        public void FutureSchema_IsNotGuessed_FreshProfileInstead()
        {
            string dir = Path.Combine(Path.GetTempPath(), "pl-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "profile.json");
            try
            {
                var p = Trained();
                p.SchemaVersion = UserProfile.CurrentSchemaVersion + 1;
                File.WriteAllText(path, ProfileStore.Serialize(p));
                var q = ProfileStore.LoadOrCreate(path, "S-1", "PC");
                Assert.Equal(UserProfile.CurrentSchemaVersion, q.SchemaVersion);
                Assert.Equal(PresenceModel.DefaultW0, q.Model.W0);
            }
            finally { Directory.Delete(dir, true); }
        }

        [Fact]
        public void ExportBaseline_KeepsWeights_DropsIdentity_ResetsCalibration()
        {
            var p = Trained();
            var b = ProfileStore.ExportBaseline(p);
            Assert.Equal(p.Model.W, b.Model.W);
            Assert.Equal("", b.UserSid);
            Assert.Equal("", b.MachineName);
            Assert.Equal(OperatingMode.Learning, b.Modes.Mode);
            Assert.Equal(0, b.Modes.WindowCount);
            Assert.Equal(0, b.Modes.ConfirmedPositives);
            Assert.Equal(0, b.Modes.PromotedUtcTicks);
            Assert.NotSame(p.Model, b.Model);
        }

        [Fact]
        public void MergeBaseline_IsElementwiseMean()
        {
            var a = new UserProfile(); var b = new UserProfile();
            a.Model.W0 = -2; b.Model.W0 = -4;
            a.Model.W[3] = 1; b.Model.W[3] = 3;
            a.Model.U[5] = -1; b.Model.U[5] = 0;
            var m = ProfileStore.MergeBaseline(new[] { a, b });
            Assert.Equal(-3, m.Model.W0, 12);
            Assert.Equal(2, m.Model.W[3], 12);
            Assert.Equal(-0.5, m.Model.U[5], 12);
            Assert.Equal(OperatingMode.Learning, m.Modes.Mode);
        }
    }
}
