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
    /// The agent. Owns the tray icon (the ONLY visible UI), the OS message window, the
    /// sensors and the engine, and translates engine decisions into OS actions.
    ///
    /// Everything runs on the single WinForms UI thread (timer ticks, WM_INPUT, WTS
    /// notifications, menu clicks), so no locking is needed anywhere.
    ///
    /// Learning mode: decisions are computed but INVISIBLE (no dim, no lock). Only the
    ///   optional "Visa låsning" notice is shown, if the user/policy enabled it.
    /// Enforcing mode: soft-dim (3 s, click-through) then LockWorkStation(). The switch
    ///   happens silently; the tray icon, tooltip and menu look identical in both modes.
    /// </summary>
    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private const double EpisodeStartIdleSeconds = 2.0;  // idle needed before an episode starts
        private const double ManualLockMaxIdleSeconds = 5.0; // lock this soon after input = Win+L
        private const double DimOpacity = 0.25;              // "tonas ned med 25 %"
        private static readonly TimeSpan SaveEvery = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan ExportEvery = TimeSpan.FromHours(24);

        private readonly AppSettings _settings;
        private readonly string _profilePath;
        private readonly UserProfile _profile;
        private readonly PresenceEngine _engine;

        private readonly MessageWindow _msg;
        private readonly KinematicsTracker _kin = new KinematicsTracker();
        private readonly FeatureBuilder _builder;
        private readonly SoftDimOverlay _overlay = new SoftDimOverlay();
        private readonly NotifyIcon _icon;
        private readonly Timer _timer;

        private bool _inputSinceEpisode = true;
        private bool _sessionLocked;
        private bool _weLocked;
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
            _engine = new PresenceEngine(_profile);
            _lastMode = _engine.Mode;

            var categories = new AppCategory();
            categories.AddReading(_settings.ExtraReadingApps);
            categories.AddLeaving(_settings.ExtraLeavingApps);

            // Optional sensors: constructed so their availability is tracked, but without a
            // capture backend they report unavailable and never influence enforcing mode.
            var sonar = new AudioSonarSensor(_profile.Config.EnableAudioSonar, backend: null);
            var ble = new BleRssiSensor(_profile.Config.EnableBleRssi);
            _builder = new FeatureBuilder(_kin, new ForegroundMonitor(categories), new TimePrior(), sonar, ble);

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
            Application.ApplicationExit += (s, e) => Shutdown();

            AgentLog.Write("start: " + _engine.Diagnostics(DateTime.UtcNow.Ticks));
        }

        // ------------------------------------------------------------------ profile

        private UserProfile LoadProfile()
        {
            string sid = WindowsIdentity.GetCurrent().User?.Value ?? "";
            string machine = Environment.MachineName;

            // Fleet seeding: no local profile yet + an admin baseline configured -> start
            // from the baseline's weights (calibration is reset, so promotion is re-earned).
            if (!File.Exists(_profilePath) && !string.IsNullOrEmpty(_settings.BaselineProfilePath))
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
            _inputSinceEpisode = true;
            if (_engine.EpisodeActive)
            {
                _engine.OnInputResumed(Now());  // scores a fired dim/lock as FP if within the window
            }
            if (_overlay.Visible) _overlay.Cancel();
        }

        private void OnTick(object sender, EventArgs e)
        {
            if (_sessionLocked || _shuttingDown) return;
            long now = Now();
            double idle = NativeMethods.IdleSeconds();

            // Input of ANY kind within the last second (keyboard included, which is never
            // hooked) ends the episode. Episodes only start at idle >= 2 s, so idle < 1 s
            // during an episode can only mean the user came back.
            if (idle < 1.0)
            {
                _inputSinceEpisode = true;
                if (_engine.EpisodeActive) _engine.OnInputResumed(now);
                if (_overlay.Visible) _overlay.Cancel();
            }

            if (!_engine.EpisodeActive)
            {
                _engine.Tick(now, _settings.ModePolicy);          // keeps the mode gate evaluated
                if (_inputSinceEpisode && idle >= EpisodeStartIdleSeconds)
                {
                    _engine.BeginEpisode(_builder.BuildSignature(), now);
                    _inputSinceEpisode = false;
                }
            }

            if (_engine.EpisodeActive)
            {
                _engine.UpdateLive(idle);
                if (idle >= _profile.Config.LongAbsenceSeconds)
                {
                    _engine.OnLongAbsence(now);
                    _overlay.Cancel();
                }
                else
                {
                    Act(_engine.Tick(now, _settings.ModePolicy));
                }
            }

            if (_engine.Mode != _lastMode)
            {
                // Silent by design: logged for the administrator, never shown to the user.
                AgentLog.Write("mode change " + _lastMode + " -> " + _engine.Mode + ": " + _engine.Diagnostics(now));
                _lastMode = _engine.Mode;
                SaveProfile();
            }
            if (DateTime.UtcNow - _lastSaveUtc >= SaveEvery) SaveProfile();
            MaybeExportToShare();
        }

        private void Act(DecisionResult r)
        {
            switch (r.Action)
            {
                case DecisionAction.SoftDim:
                    if (r.Mode == OperatingMode.Enforcing)
                        _overlay.BeginDim(DimOpacity, _profile.Config.SoftDimSeconds);
                    break; // Learning: invisible by design

                case DecisionAction.TriggerLock:
                    if (r.Mode == OperatingMode.Enforcing)
                    {
                        _overlay.Cancel();
                        _weLocked = true;
                        if (!NativeMethods.LockWorkStation())
                        {
                            _weLocked = false;
                            _engine.DiscardEnforcedLock();
                            AgentLog.Write("LockWorkStation refused (policy DisableLockWorkstation?)");
                        }
                    }
                    else if (_settings.ShowLockNotification)
                    {
                        _icon.ShowBalloonTip(8000, "PresenceLock",
                            "Datorn hade låsts nu. Klicka här om det hade varit fel.", ToolTipIcon.None);
                    }
                    break;
            }
        }

        private void OnBalloonClicked(object sender, EventArgs e)
        {
            if (_engine.OnUserFlaggedUnjustified(Now())) SaveProfile();
        }

        private void OnSessionLocked()
        {
            long now = Now();
            _overlay.Cancel();
            if (!_weLocked)
            {
                double idle = NativeMethods.IdleSeconds();
                if (idle <= ManualLockMaxIdleSeconds)
                {
                    // Win+L / Ctrl+Alt+Del -> Lock right after input: gold-standard departure.
                    var sig = _builder.BuildSignature();
                    sig.IdleSeconds = idle;
                    _engine.OnManualLock(sig, now);
                }
                else if (_engine.EpisodeActive)
                {
                    // Windows' own inactivity/screensaver lock or a remote lock: no clean label.
                    if (idle >= _profile.Config.LongAbsenceSeconds) _engine.OnLongAbsence(now);
                    else _engine.AbortEpisode();
                }
            }
            _sessionLocked = true;
            SaveProfile();
        }

        private void OnSessionUnlocked()
        {
            if (_weLocked)
            {
                _engine.ApplyEnforcedLockOutcome(Now()); // quick unlock => FP, long => confirmed
                _weLocked = false;
            }
            _sessionLocked = false;
            _inputSinceEpisode = true;
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
    }
}
