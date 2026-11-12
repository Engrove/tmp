using System;
using System.Drawing;
using System.IO;
using System.Security.Principal;
using System.Windows.Forms;
using Microsoft.Win32;
using PresenceLock.App.Interop;
using PresenceLock.App.Policy;
using PresenceLock.App.Sensors;
using PresenceLock.App.Settings;
using PresenceLock.Core;

namespace PresenceLock.App
{
    /// <summary>
    /// The agent shell. It owns the tray icon (the ONLY visible UI), the OS message window,
    /// the sensors and the overlay — and NO decision logic. Every second it reads idle time
    /// and passive OS state, hands them to <see cref="PresenceCoordinator"/> (pure, unit-tested
    /// Core logic) and performs the returned action. Session lock/unlock events are forwarded.
    ///
    /// Everything runs on the single WinForms UI thread, so no locking is needed.
    /// Learning and enforcing mode look identical from the outside (stealth requirement).
    /// </summary>
    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private const double DimOpacity = 0.25;              // "tonas ned med 25 %"
        private static readonly TimeSpan SaveEvery = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan ExportEvery = TimeSpan.FromHours(24);

        private readonly AppSettings _settings;
        private readonly string _profilePath;
        private readonly UserProfile _profile;
        private readonly PresenceCoordinator _coord;

        private readonly MessageWindow _msg;
        private readonly KinematicsTracker _kin = new KinematicsTracker();
        private readonly FeatureBuilder _builder;
        private readonly PassiveSignalReader _signals;
        private readonly SoftDimOverlay _overlay = new SoftDimOverlay();
        private readonly NotifyIcon _icon;
        private readonly Timer _timer;

        private DateTime _lastSaveUtc = DateTime.UtcNow;
        private DateTime _lastExportUtc = DateTime.MinValue;
        private OperatingMode _lastMode;
        private bool _shuttingDown;

        public TrayApplicationContext(AppSettings settings)
        {
            _settings = settings;
            _profilePath = ProfileStore.DefaultPath();
            _profile = LoadProfile();
            _settings.ApplyTo(_profile);
            _coord = new PresenceCoordinator(new PresenceEngine(_profile), _settings.ToCoordinatorConfig());
            _lastMode = _coord.Engine.Mode;

            var categories = new AppCategory();
            categories.AddReading(_settings.ExtraReadingApps);
            categories.AddLeaving(_settings.ExtraLeavingApps);

            // Optional sensors: constructed so their availability is tracked, but without a
            // capture backend they report unavailable and never influence enforcing mode.
            var sonar = new AudioSonarSensor(_profile.Config.EnableAudioSonar, backend: null);
            var ble = new BleRssiSensor(_profile.Config.EnableBleRssi);
            _builder = new FeatureBuilder(_kin, new ForegroundMonitor(categories), new TimePrior(), sonar, ble);
            _signals = new PassiveSignalReader(_settings.HoldIgnoreApps);

            _msg = new MessageWindow();
            _msg.RawInput += OnRawInput;
            _msg.SessionLocked += OnSessionLocked;
            _msg.SessionUnlocked += OnSessionUnlocked;

            _icon = new NotifyIcon
            {
                Icon = SystemIcons.Shield,
                Text = "PresenceLock",          // identical in both modes (stealth requirement)
                Visible = true,
                ContextMenuStrip = BuildMenu()
            };
            _icon.BalloonTipClicked += OnBalloonClicked;

            _timer = new Timer { Interval = 1000 };
            _timer.Tick += OnTick;
            _timer.Start();

            SystemEvents.SessionEnding += OnSessionEnding;

            AgentLog.Write("start: " + _coord.Engine.Diagnostics(DateTime.UtcNow.Ticks)
                           + " powerSignal=" + (_signals.PowerSignalAllowed ? "on" : "off (server SKU)"));
        }

        // ------------------------------------------------------------------ profile

        private UserProfile LoadProfile()
        {
            string sid = WindowsIdentity.GetCurrent().User?.Value ?? "";
            bool localExisted = File.Exists(_profilePath);
            var profile = LoadLocalOrBaseline(sid, localExisted);

            if (!_settings.AllowUserExit)
            {
                // NIS2 mode: profile.json is user-writable. If it was deleted, demoted from
                // Enforcing to Learning, or its learning clock restarted, the guard's protected
                // copy (read-only for the user) is used instead.
                var chosen = TamperProtection.ChooseTrusted(profile, localExisted, Guard.ProtectedStore.TryRead(sid),
                                                            sid, _settings.ModePolicy, out string reason);
                if (!ReferenceEquals(chosen, profile)) AgentLog.Write(reason);
                profile = chosen;
            }

            // Policy-like fields are never trusted from the file: defaults now, GPO in ApplyTo().
            TamperProtection.ResetPolicyFields(profile);
            return profile;
        }

        private UserProfile LoadLocalOrBaseline(string sid, bool localExisted)
        {
            string machine = Environment.MachineName;

            // Fleet seeding: no local profile yet + an admin baseline configured -> start
            // from the baseline's weights (calibration is reset, so promotion is re-earned).
            if (!localExisted && !string.IsNullOrEmpty(_settings.BaselineProfilePath))
            {
                try
                {
                    var baseline = ProfileStore.ExportBaseline(
                        ProfileStore.Deserialize(File.ReadAllText(_settings.BaselineProfilePath)));
                    baseline.UserSid = sid;
                    baseline.MachineName = machine;
                    AgentLog.Write("seeded from baseline profile");
                    return baseline;
                }
                catch (Exception ex)
                {
                    AgentLog.Write("baseline unusable, starting fresh: " + ex.GetType().Name);
                }
            }
            return ProfileStore.LoadOrCreate(_profilePath, sid, machine);
        }

        private void SaveProfile()
        {
            try
            {
                ProfileStore.Save(_profilePath, _profile);
                _lastSaveUtc = DateTime.UtcNow;
            }
            catch (Exception ex) { AgentLog.Write("save failed: " + ex.GetType().Name); }
        }

        private void MaybeExportToShare()
        {
            if (string.IsNullOrEmpty(_settings.ProfileExportDirectory)) return;
            if (DateTime.UtcNow - _lastExportUtc < ExportEvery) return;
            _lastExportUtc = DateTime.UtcNow;
            try
            {
                Directory.CreateDirectory(_settings.ProfileExportDirectory);
                string name = Sanitize(Environment.MachineName) + "_" + Sanitize(Environment.UserName) + ".json";
                File.WriteAllText(Path.Combine(_settings.ProfileExportDirectory, name),
                                  ProfileStore.Serialize(_profile));
            }
            catch (Exception ex) { AgentLog.Write("share export failed: " + ex.GetType().Name); }
        }

        private static string Sanitize(string s)
        {
            foreach (char c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s;
        }

        // ------------------------------------------------------------------ OS events

        private static long Now() => DateTime.UtcNow.Ticks;

        private void OnRawInput(RawInputSample sample)
        {
            _kin.Feed(sample);
            // Instant visual feedback; the coordinator itself sees the input on the next tick
            // (idle < 1 s), before it could take any further action.
            if (_overlay.Visible) _overlay.Cancel();
        }

        private void OnTick(object sender, EventArgs e)
        {
            if (_shuttingDown) return;
            long now = Now();
            double idle = NativeMethods.IdleSeconds();

            // Passive state is only needed while idle (cheap registry/power reads, cached 5 s
            // and refreshed at the start of every idle period).
            var signals = idle >= 2.0
                ? _signals.Read(DateTime.UtcNow.AddSeconds(-idle))
                : default(PassiveSignals);

            Act(_coord.Tick(now, idle, signals, _settings.ModePolicy, _builder.BuildSignature));

            if (_coord.Engine.Mode != _lastMode)
            {
                // Silent by design: logged for the administrator, never shown to the user.
                AgentLog.Write("mode change " + _lastMode + " -> " + _coord.Engine.Mode + ": "
                               + _coord.Engine.Diagnostics(now));
                _lastMode = _coord.Engine.Mode;
                SaveProfile();
            }
            if (DateTime.UtcNow - _lastSaveUtc >= SaveEvery) SaveProfile();
            MaybeExportToShare();
        }

        private void Act(CoordinatorResult r)
        {
            switch (r.Action)
            {
                case CoordinatorAction.SoftDim:
                    _overlay.BeginDim(DimOpacity, _profile.Config.SoftDimSeconds);
                    break;

                case CoordinatorAction.CancelDim:
                    _overlay.Cancel();
                    break;

                case CoordinatorAction.Lock:
                    _overlay.Cancel();
                    if (!NativeMethods.LockWorkStation())
                    {
                        _coord.OnLockRefused();
                        AgentLog.Write("LockWorkStation refused (policy DisableLockWorkstation?)");
                    }
                    break;

                case CoordinatorAction.WouldLockNotice:
                    if (_settings.ShowLockNotification)
                        _icon.ShowBalloonTip(8000, "PresenceLock",
                            "Datorn hade låsts nu. Klicka här om det hade varit fel.", ToolTipIcon.None);
                    break;
            }
        }

        private void OnBalloonClicked(object sender, EventArgs e)
        {
            if (_coord.OnUserFlaggedUnjustified(Now())) SaveProfile();
        }

        private void OnSessionLocked()
        {
            _overlay.Cancel();
            _coord.OnSessionLocked(Now(), NativeMethods.IdleSeconds(), _builder.BuildSignature);
            SaveProfile();
        }

        private void OnSessionUnlocked()
        {
            _coord.OnSessionUnlocked(Now());   // our own lock: quick unlock => FP, long => confirmed
            _kin.Clear();
            SaveProfile();
        }

        private void OnSessionEnding(object sender, SessionEndingEventArgs e) => SaveProfile();

        // ------------------------------------------------------------------ tray menu

        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();

            var notify = new ToolStripMenuItem("Visa låsningsnotiser")
            {
                CheckOnClick = !_settings.ShowLockNotificationLocked,
                Checked = _settings.ShowLockNotification,
                Enabled = !_settings.ShowLockNotificationLocked
            };
            notify.CheckedChanged += (s, e) =>
            {
                _settings.ShowLockNotification = notify.Checked;
                PolicyReader.SaveShowLockNotificationPreference(notify.Checked);
            };
            menu.Items.Add(notify);

            if (_settings.AllowProfileExport)
            {
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("Exportera profil…", null, (s, e) => Export(baseline: false));
                menu.Items.Add("Exportera anonym baslinje…", null, (s, e) => Export(baseline: true));
            }

            if (_settings.AllowUserExit)
            {
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("Avsluta", null, (s, e) => ExitThread());
            }
            // AllowUserExit = 0 (NIS2 mode): no exit item, the process refuses termination by
            // the user, the message loop restarts, and the guard service locks the session if
            // the agent disappears anyway.
            return menu;
        }

        private void Export(bool baseline)
        {
            using (var dlg = new SaveFileDialog
            {
                Filter = "PresenceLock-profil (*.json)|*.json",
                FileName = (baseline ? "baseline_" : Sanitize(Environment.MachineName) + "_" + Sanitize(Environment.UserName) + "_")
                           + DateTime.Now.ToString("yyyyMMdd") + ".json"
            })
            {
                if (dlg.ShowDialog() != DialogResult.OK) return;
                try
                {
                    var p = baseline ? ProfileStore.ExportBaseline(_profile) : _profile;
                    File.WriteAllText(dlg.FileName, ProfileStore.Serialize(p));
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Export misslyckades: " + ex.Message, "PresenceLock",
                                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }

        // ------------------------------------------------------------------ shutdown

        private void Shutdown()
        {
            if (_shuttingDown) return;
            _shuttingDown = true;
            _timer.Stop();
            SaveProfile();
            SystemEvents.SessionEnding -= OnSessionEnding;
            _icon.Visible = false;
            _icon.Dispose();
            _overlay.Dispose();
            _msg.Dispose();
            AgentLog.Write("stop");
        }

        protected override void ExitThreadCore()
        {
            Shutdown();
            base.ExitThreadCore();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) Shutdown();   // also covers a loop ended by a foreign WM_QUIT
            base.Dispose(disposing);
        }
    }
}
