using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    /// <summary>
    /// The decisive check: replay the deterministic multi-week scenario against the REAL C#
    /// engine and compare with the Python reference's output (verify/parity_golden.json).
    /// Thousands of SGD updates and gate decisions must land on the same numbers.
    /// </summary>
    public class ParityTests
    {
        private readonly ITestOutputHelper _out;
        public ParityTests(ITestOutputHelper output) { _out = output; }

        internal static string RepoFile(params string[] parts)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(new[] { dir.FullName }.Concat(parts).ToArray());
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            throw new FileNotFoundException("not found above test dir: " + Path.Combine(parts));
        }

        public static TheoryData<string> Cases()
        {
            var data = new TheoryData<string>();
            using (var doc = JsonDocument.Parse(File.ReadAllText(RepoFile("verify", "parity_golden.json"))))
                foreach (var c in doc.RootElement.GetProperty("cases").EnumerateArray())
                    data.Add(c.GetProperty("name").GetString());
            return data;
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void CSharpEngine_Matches_PythonReference(string caseName)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(RepoFile("verify", "parity_golden.json")));
            var c = doc.RootElement.GetProperty("cases").EnumerateArray()
                       .First(e => e.GetProperty("name").GetString() == caseName);
            var exp = c.GetProperty("expected");

            var res = UserSim.Run(c.GetProperty("days").GetInt32(), c.GetProperty("seed").GetInt64(),
                                  c.GetProperty("ambiguous").GetBoolean());
            var m = res.Engine.Profile.Model;
            var mc = res.Engine.Profile.Modes;

            // --- parameters: report the worst deviation, then require it to be ~0 ---
            double maxDiff = Math.Abs(m.W0 - exp.GetProperty("W0").GetDouble());
            maxDiff = Math.Max(maxDiff, Math.Abs(m.U0 - exp.GetProperty("U0").GetDouble()));
            var ew = exp.GetProperty("W").EnumerateArray().Select(v => v.GetDouble()).ToArray();
            var eu = exp.GetProperty("U").EnumerateArray().Select(v => v.GetDouble()).ToArray();
            int bitExact = (m.W0 == exp.GetProperty("W0").GetDouble() ? 1 : 0)
                         + (m.U0 == exp.GetProperty("U0").GetDouble() ? 1 : 0);
            for (int i = 0; i < FeatureSchema.Count; i++)
            {
                maxDiff = Math.Max(maxDiff, Math.Abs(m.W[i] - ew[i]));
                maxDiff = Math.Max(maxDiff, Math.Abs(m.U[i] - eu[i]));
                if (m.W[i] == ew[i]) bitExact++;
                if (m.U[i] == eu[i]) bitExact++;
            }
            _out.WriteLine($"{caseName}: max |C# - Python| = {maxDiff:E2}, bit-exact params {bitExact}/{2 + 2 * FeatureSchema.Count}");
            Assert.True(maxDiff <= 1e-12, $"parameter divergence {maxDiff:E3}");

            // --- discrete outcomes must be identical ---
            Assert.Equal(exp.GetProperty("mode").GetString(), mc.Mode.ToString());
            Assert.Equal(exp.GetProperty("learning_extended").GetBoolean(), mc.LearningExtended);
            Assert.Equal(exp.GetProperty("positives").GetInt32(), mc.ConfirmedPositives);
            Assert.Equal(exp.GetProperty("fired").GetInt32(), mc.FiredDecisions);
            Assert.Equal(exp.GetProperty("rejected").GetInt32(), mc.RejectedDecisions);
            Assert.Equal(exp.GetProperty("window_count").GetInt32(), mc.WindowCount);
            Assert.Equal(exp.GetProperty("window_head").GetInt32(), mc.WindowHead);
            Assert.Equal(exp.GetProperty("window_fp").GetInt32(), mc.WindowFalsePositives());
            Assert.Equal(exp.GetProperty("promoted_at").GetInt64(), mc.PromotedUtcTicks);

            var pd = exp.GetProperty("promoted_day");
            int? expectedDay = pd.ValueKind == JsonValueKind.Null ? (int?)null : pd.GetInt32();
            Assert.Equal(expectedDay, res.PromotedDay);

            var ee = exp.GetProperty("enforcing");
            Assert.Equal(ee.GetProperty("episodes").GetInt32(), res.Enforcing.Episodes);
            Assert.Equal(ee.GetProperty("dims_on_present").GetInt32(), res.Enforcing.DimsOnPresent);
            Assert.Equal(ee.GetProperty("locks_on_present").GetInt32(), res.Enforcing.LocksOnPresent);
            Assert.Equal(ee.GetProperty("locked_departures").GetInt32(), res.Enforcing.LockedDepartures);
            Assert.Equal(ee.GetProperty("missed_departures").GetInt32(), res.Enforcing.MissedDepartures);
            Assert.Equal(exp.GetProperty("enforcing_latency_sum").GetInt32(), res.Enforcing.Latencies.Sum());
            var el = exp.GetProperty("learning");
            Assert.Equal(el.GetProperty("episodes").GetInt32(), res.Learning.Episodes);
        }
    }
}
