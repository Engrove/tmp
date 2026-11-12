using System;

namespace PresenceLock.App.Sensors
{
    /// <summary>
    /// Single-bin Goertzel power detector. Cheap, allocation-free, and the standard way
    /// to measure the energy at one frequency (here ~20 kHz) without a full FFT. This is
    /// exact DSP and is verified in /verify (goertzel check).
    /// </summary>
    public sealed class Goertzel
    {
        private readonly double _coeff;
        private double _s0, _s1, _s2;
        private int _n;
        private readonly int _blockSize;

        public Goertzel(double targetHz, double sampleRateHz, int blockSize)
        {
            _blockSize = blockSize;
            double k = Math.Round(blockSize * targetHz / sampleRateHz);
            double omega = 2.0 * Math.PI * k / blockSize;
            _coeff = 2.0 * Math.Cos(omega);
        }

        public void Reset() { _s0 = _s1 = _s2 = 0; _n = 0; }

        public void Add(double sample)
        {
            _s0 = _coeff * _s1 - _s2 + sample;
            _s2 = _s1;
            _s1 = _s0;
            _n++;
        }

        /// <summary>Normalised power at the target bin for the block added so far.</summary>
        public double Power()
        {
            double power = _s1 * _s1 + _s2 * _s2 - _coeff * _s1 * _s2;
            return power / (_blockSize * _blockSize);
        }
    }

    /// <summary>A pluggable microphone/loopback capture source (opt-in, see note below).</summary>
    public interface IAudioCaptureBackend
    {
        bool TryStart(out int sampleRate);
        /// <summary>Fill buffer with mono float samples; return count written (0 if none).</summary>
        int Read(float[] buffer);
        void Stop();
    }

    /// <summary>
    /// OPTIONAL, learning-period-only presence/Doppler sensor built on an inaudible
    /// ~20 kHz probe tone and a narrow Goertzel analysis of the echo.
    ///
    /// HONEST SCOPE (read this):
    ///   * The DSP here (Goertzel, band comparison, Doppler sign) is real and verified.
    ///   * The CAPTURE + RENDER plumbing is NOT hand-rolled WASAPI COM in this build.
    ///     Shipping ~300 lines of untested COM interop as if it worked would be exactly
    ///     the kind of unverified claim this project refuses. Instead you attach an
    ///     IAudioCaptureBackend (NAudio's WasapiLoopbackCapture / WasapiCapture is the
    ///     recommended one-file adapter) plus a quiet 20 kHz render tone.
    ///   * Until a backend is attached, IsAvailable is false, the feature is marked
    ///     unavailable, and in ENFORCING mode the model never depends on it. This matches
    ///     the requirement that mode 2 must not assume the mic/sonar is usable.
    ///
    /// Doppler principle: body moving away lowers the echo frequency slightly, shifting
    /// energy from the 20.0 kHz bin into a lower side bin (e.g. 19.8 kHz). We report the
    /// normalised (lowerBin - upperBin) imbalance as "moving away".
    /// </summary>
    public sealed class AudioSonarSensor
    {
        private readonly IAudioCaptureBackend _backend;
        private int _sampleRate;
        private bool _started;

        public bool Enabled { get; }
        public bool IsAvailable => _backend != null && _started;

        private const double ProbeHz = 20000.0;
        private const double LowerHz = 19800.0;
        private const double UpperHz = 20200.0;
        private const int Block = 2048;

        public AudioSonarSensor(bool enabled, IAudioCaptureBackend backend)
        {
            Enabled = enabled;
            _backend = backend;
            if (Enabled && _backend != null)
                _started = _backend.TryStart(out _sampleRate);
        }

        /// <summary>
        /// Analyse one captured block. Returns (present, dopplerAway) where present is a
        /// centered presence estimate and dopplerAway in [0,1]. Returns (0,0) and
        /// available=false when no backend is wired.
        /// </summary>
        public bool Analyse(float[] block, int count, out double present, out double dopplerAway)
        {
            present = 0.0; dopplerAway = 0.0;
            if (!IsAvailable || count < Block) return false;

            var gProbe = new Goertzel(ProbeHz, _sampleRate, Block);
            var gLower = new Goertzel(LowerHz, _sampleRate, Block);
            var gUpper = new Goertzel(UpperHz, _sampleRate, Block);
            for (int i = 0; i < Block; i++)
            {
                double s = block[i];
                gProbe.Add(s); gLower.Add(s); gUpper.Add(s);
            }
            double p = gProbe.Power(), lo = gLower.Power(), hi = gUpper.Power();
            double total = p + lo + hi + 1e-12;

            // Stable strong echo at the probe bin => body present and still.
            present = (p / total) * 2.0 - 1.0; // centered

            // Energy pushed to the lower side bin => receding motion.
            double imbalance = (lo - hi) / (lo + hi + 1e-12);
            dopplerAway = imbalance > 0 ? Math.Min(1.0, imbalance) : 0.0;
            return true;
        }

        public void Stop() { if (_started) { _backend.Stop(); _started = false; } }
    }
}
