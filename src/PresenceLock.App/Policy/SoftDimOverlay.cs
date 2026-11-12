using System;
using System.Drawing;
using System.Windows.Forms;

namespace PresenceLock.App.Policy
{
    /// <summary>
    /// The 3-second "soft-dim" warning. A borderless, click-THROUGH, top-most black form
    /// spanning all monitors whose opacity ramps from 0 toward a configured maximum. It is
    /// purely visual: because it is click-through (WS_EX_TRANSPARENT), the user's instinctive
    /// 1 mm mouse nudge both reaches the app underneath AND is seen by our raw-input hook,
    /// which cancels the dim and records a negative training example — no PIN, no interruption.
    /// </summary>
    public sealed class SoftDimOverlay : Form
    {
        private readonly Timer _fade = new Timer { Interval = 60 };
        private double _target;
        private double _rampPerTick;

        public SoftDimOverlay()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            // NOT "TopMost = true": that setter calls SetWindowPos without SWP_NOACTIVATE and
            // can steal keyboard focus from the user's app. WS_EX_TOPMOST below avoids that.
            BackColor = Color.Black;
            Opacity = 0.0;
            StartPosition = FormStartPosition.Manual;
            var vs = SystemInformation.VirtualScreen;
            Bounds = vs;
            _fade.Tick += OnFade;
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_LAYERED = 0x00080000;
                const int WS_EX_TRANSPARENT = 0x00000020; // click-through
                const int WS_EX_NOACTIVATE = 0x08000000;
                const int WS_EX_TOOLWINDOW = 0x00000080;  // no alt-tab entry
                const int WS_EX_TOPMOST = 0x00000008;     // above other windows, without activation
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
                            | WS_EX_TOOLWINDOW | WS_EX_TOPMOST;
                return cp;
            }
        }

        /// <summary>Start ramping the dim toward maxOpacity over the given seconds.</summary>
        public void BeginDim(double maxOpacity, double seconds)
        {
            _target = Math.Max(0.0, Math.Min(0.9, maxOpacity));
            int ticks = Math.Max(1, (int)(seconds * 1000 / _fade.Interval));
            _rampPerTick = _target / ticks;
            var vs = SystemInformation.VirtualScreen;
            Bounds = vs;
            if (!Visible) { Opacity = 0.0; Show(); }
            _fade.Start();
        }

        private void OnFade(object sender, EventArgs e)
        {
            double next = Opacity + _rampPerTick;
            if (next >= _target) { next = _target; _fade.Stop(); }
            Opacity = next;
        }

        /// <summary>Instantly clear the dim (user re-asserted presence, or we escalated to lock).</summary>
        public void Cancel()
        {
            _fade.Stop();
            Opacity = 0.0;
            if (Visible) Hide();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _fade.Dispose();
            base.Dispose(disposing);
        }
    }
}
