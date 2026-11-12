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
            Assert.Equal(p.Modes.OutcomeWindow, q.Modes.OutcomeWindow);
            Assert.Equal(p.Modes.WindowHead, q.Modes.WindowHead);
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
            json = Regex.Replace(json, "\"OutcomeWindow\":\\[[^\\]]*\\],?", "");
            var q = ProfileStore.Deserialize(json);
            Assert.Equal(ModeController.WindowSize, q.Modes.OutcomeWindow.Length);
            Assert.Equal(0, q.Modes.WindowCount);
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
