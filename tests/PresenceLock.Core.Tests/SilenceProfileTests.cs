using System;
using PresenceLock.Core;
using Xunit;
using Xunit.Abstractions;

namespace PresenceLock.Core.Tests
{
    public class SilenceProfileTests
    {
        private readonly ITestOutputHelper _out;
        public SilenceProfileTests(ITestOutputHelper o) { _out = o; }

        private static readonly long T0 = new DateTime(2026, 3, 2, 8, 0, 0, DateTimeKind.Utc).Ticks;
        private const int Reading = 1;

        /// <summary>Office reader: pauses 30-100 s at the desk, 2 departures a day of 5-16 min.</summary>
        private static SilenceProfile Office(int days, long seed)
        {
            var rng = new UserSim.Lcg(seed);
            var p = new SilenceProfile();
            for (int d = 0; d < days; d++)
            {
                long now = T0 + d * TimeSpan.TicksPerDay;
                for (int i = 0; i < 8; i++) p.Record(Reading, rng.UniformInt(30, 100), now);
                for (int i = 0; i < 2; i++) p.Record(Reading, rng.UniformInt(310, 960), now);
            }
            return p;
        }

        /// <summary>CAD user: studies 1-8 min continuously, coffee 8-15 min twice a day.</summary>
        private static SilenceProfile Cad(int days, long seed)
        {
            var rng = new UserSim.Lcg(seed);
            var p = new SilenceProfile();
            for (int d = 0; d < days; d++)
            {
                long now = T0 + d * TimeSpan.TicksPerDay;
                for (int i = 0; i < 30; i++) p.Record(Reading, rng.UniformInt(60, 480), now);
                for (int i = 0; i < 2; i++) p.Record(Reading, rng.UniformInt(480, 900), now);
            }
            return p;
        }

        [Fact]
        public void Office_TwoSeparatedPopulations_AreRecognised()
        {
            var p = Office(15, 3);
            var m = p.Fit(Reading, T0 + 15 * TimeSpan.TicksPerDay);
            _out.WriteLine(m.Describe());
            Assert.True(m.Valid, m.Reason);
            Assert.InRange(m.BoundarySeconds, 100, 310);
            Assert.True(m.PosteriorAway(60) < 0.01);
            Assert.True(m.PosteriorAway(400) > 0.99);
            Assert.True(m.PosteriorAway(3000) > 0.99);           // monotone in the far tail
        }

        [Fact]
        public void Cad_ContinuousStudying_CannotBeSplit_SoTheGateStaysConservative()
        {
            // Studying times run continuously into coffee-break times: the profile must refuse to
            // decide rather than call long studies "away".
            var p = Cad(15, 3);
            var m = p.Fit(Reading, T0 + 15 * TimeSpan.TicksPerDay);
            _out.WriteLine(m.Describe());
            Assert.False(m.Valid);
            Assert.Equal(0.0, m.PosteriorAway(470));
        }

        [Fact]
        public void EvenlySpreadStudying_IsOnePopulation_EvenWithoutCoffee()
        {
            // Regression: studies uniform over 1-8 min fit two Gaussians with D ~ 2.0. The valley
            // check must reject it, or long studies would be scored "away".
            var rng = new UserSim.Lcg(5);
            var p = new SilenceProfile();
            for (int d = 0; d < 30; d++)
                for (int i = 0; i < 30; i++) p.Record(Reading, rng.UniformInt(60, 480), T0 + d * TimeSpan.TicksPerDay);
            var m = p.Fit(Reading, T0 + 30 * TimeSpan.TicksPerDay);
            _out.WriteLine(m.Describe());
            Assert.False(m.Valid);
        }

        [Fact]
        public void TooLittleData_DecidesNothing()
        {
            var p = Office(2, 3);                                  // 20 silences < 40
            Assert.False(p.Fit(Reading, T0 + 2 * TimeSpan.TicksPerDay).Valid);
        }

        [Fact]
        public void OldRhythm_FadesWithA14DayHalfLife()
        {
            var p = Office(15, 3);
            double n0 = p.Count(Reading, T0 + 14 * TimeSpan.TicksPerDay);
            double n14 = p.Count(Reading, T0 + 28 * TimeSpan.TicksPerDay);
            Assert.InRange(n14 / n0, 0.499, 0.501);
            Assert.Equal(0.0, p.Count(0, T0 + 28 * TimeSpan.TicksPerDay));   // other contexts untouched
        }

        [Fact]
        public void PatternChange_IsFollowed()
        {
            // Kaizen: an office reader becomes a CAD user. After four half-lives the old rhythm is
            // ~6 % of the data and the profile no longer claims two separated populations.
            var p = Office(15, 3);
            var rng = new UserSim.Lcg(9);
            for (int d = 15; d < 75; d++)
            {
                long now = T0 + d * TimeSpan.TicksPerDay;
                for (int i = 0; i < 30; i++) p.Record(Reading, rng.UniformInt(60, 480), now);
                for (int i = 0; i < 2; i++) p.Record(Reading, rng.UniformInt(480, 900), now);
            }
            var m = p.Fit(Reading, T0 + 75 * TimeSpan.TicksPerDay);
            _out.WriteLine(m.Describe());
            Assert.True(!m.Valid || m.PosteriorAway(470) < 0.9);
        }

        [Fact]
        public void CorruptCounters_AreRepaired()
        {
            var p = new SilenceProfile { Counts = new double[] { double.NaN, -1 } };
            p.Normalize();
            Assert.Equal(SilenceProfile.Contexts * SilenceProfile.Bins, p.Counts.Length);
        }
    }
}
