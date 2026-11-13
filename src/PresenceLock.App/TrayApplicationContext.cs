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

        private AppSettings _settings;                       // reloaded from policy while running (review F09)
        private readonly BackgroundWriter _io = new BackgroundWriter();   // all file/network I/O (review F05)
        private DateTime _lastRegistrationTryUtc = DateTime.MinValue, _lastHeartbeatUtc = DateTime.MinValue,
                         _lastPolicyReloadUtc = DateTime.UtcNow;
        private bool _signalDegradedReported;
        private volatile HousekeepingReport _hkResult;            // set by the background job, applied on the UI thread
        private volatile int _hkLines;
        private volatile bool _exportInFlight;
        private long _exportDoneTicks;                             // Interlocked: >0 success time, <0 failure time
        private static readonly TimeSpan PolicyReloadEvery = TimeSpan.FromMinutes(5);
        private readonly string _profilePath;
        private readonly UserProfile _profile;
        private readonly HabitJournal _habits;               // null when habit learning is off
        private readonly PresenceCoordinator _coord;

        private readonly MessageWindow _msg;
        private readonly KinematicsTracker _kin = new KinematicsTracker();
        private readonly FeatureBuilder _builder;
        private readonly PassiveSignalReader _signals;
        private readonly SoftDimOverlay _overlay = new SoftDimOverlay();
        private readonly NotifyIcon _icon;
        private readonly Timer _timer;

        private DateTime _lastSaveUtc = DateTime.UtcNow;
        private OperatingMode _lastMode;
        private bool _shuttingDown;

        public TrayApplicationContext(AppSettings settings)
        {
            _settings = settings;
            _profilePath = ProfileStore.DefaultPath();
            _profile = LoadProfile();
            _settings.ApplyTo(_profile);

            // Habit journal: a separate, never-exported file (it is a presence timeline). Losing or
            // editing it can only remove habit acceleration, never weaken locking below policy.
            string sid = WindowsIdentity.GetCurrent().User?.Value ?? "";
            string journalRecovery = null;
            _habits = _settings.HabitLearningEnabled ? HabitStore.LoadWithRecovery(HabitStore.DefaultPath(), sid, out journalRecovery) : null;
            if (journalRecovery != null)
                AgentEvents.Write(AgentEvents.JournalReset, System.Diagnostics.EventLogEntryType.Information, "PresenceLock: " + journalRecovery);
            var coordinatorConfig = _settings.ToCoordinatorConfig();
            coordinatorConfig.Habits = _habits;
            _coord = new PresenceCoordinator(new PresenceEngine(_profile), coordinatorConfig);
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
            _msg.SessionDisconnected += OnSessionDisconnected;
            _msg.SessionConnected += OnSessionConnected;
            if (!_msg.EnsureRegistered()) ReportSignalDegraded("registration failed at start (error " + _msg.LastRegistrationError + ")");
            AgentHeartbeat.Beat();

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

            AgentLog.Write("start: PresenceLock " + AgentIdentity.Full + " (" + AgentIdentity.ExePath() + "); " + _coord.Engine.Diagnostics(DateTime.UtcNow.Ticks)
                           + " powerSignal=" + (_signals.PowerSignalAllowed ? "on" : "off (server SKU)"));
            RunHousekeeping();
        }

        // ------------------------------------------------------------------ cleaning service

        private DateTime _lastHousekeepingUtc;

        /// <summary>
        /// At start and every 24 h: retire journal data and log lines past their retention, remove
        /// crash leftovers, then save and refresh the last-known-good backup. Every step is
        /// independent; nothing here can stop the agent.
        /// </summary>
        private void RunHousekeeping()
        {
            _lastHousekeepingUtc = DateTime.UtcNow;
            var report = new HousekeepingReport();
            var r = _settings.ToRetentionPolicy();
            try
            {
                // In-memory retirement here (the UI thread owns these objects) ...
                if (_habits != null) Housekeeping.PruneJournal(_habits, DateTime.UtcNow.Ticks, new HabitPolicy(), report);
                Housekeeping.RetirePauses(_profile, DateTime.UtcNow.Ticks);
                SaveProfile();
                // ... file work in the background, queued after the save, so the backup is taken
                // from the file just written. Results are applied on the next tick.
                string dir = ProfileStore.DefaultDirectory(), path = _profilePath;
                _io.Post("housekeeping", () =>
                {
                    Housekeeping.CleanAgentDirectory(dir, DateTime.UtcNow, r, report);
                    _hkLines = AgentLog.Retire(r.LogRetentionDays);
                    Housekeeping.WriteBackup(path, report);
                    _hkResult = report;
                });
            }
            catch (Exception ex) { AgentLog.Write("housekeeping step failed: " + ex.GetType().Name); }
        }

        private void ReportSignalDegraded(string what)
        {
            _signalDegradedReported = true;
            AgentEvents.Write(AgentEvents.SignalDegraded, System.Diagnostics.EventLogEntryType.Warning,
                "PresenceLock signal degraded: " + what + ". Raw mouse input registered: " + _msg?.RawInputRegistered +
                ", session notifications registered: " + _msg?.SessionNotificationsRegistered +
                ". Without session notifications a lock cannot be confirmed: requests are repeated and fall back to a disconnect.");
        }

        /// <summary>
        /// Group Policy changes reach a running agent (review F09): re-read every 5 minutes, apply what
        /// changed to the coordinator, the profile's policy fields and the menu. Hardening is applied
        /// when exit becomes forbidden; it is never removed while running (that needs a restart).
        /// </summary>
        private void ReloadPolicy()
        {
            _lastPolicyReloadUtc = DateTime.UtcNow;
            AppSettings fresh;
            try { fresh = PolicyReader.Load(); }
            catch (Exception ex) { AgentLog.Write("policy reload failed: " + ex.GetType().Name); return; }
            string before = Fingerprint(_settings), after = Fingerprint(fresh);
            if (before == after) return;

            bool exitWasAllowed = _settings.AllowUserExit;
            _settings = fresh;
            var c = fresh.ToCoordinatorConfig();
            var live = _coord.Config;
            live.MediaHoldEnabled = c.MediaHoldEnabled;
            live.MeetingHoldEnabled = c.MeetingHoldEnabled;
            live.HoldMaxSeconds = c.HoldMaxSeconds;
            live.MinLockIdleSeconds = c.MinLockIdleSeconds;
            live.MaxLearnedHorizonSeconds = c.MaxLearnedHorizonSeconds;
            live.ConfirmGraceSeconds = c.ConfirmGraceSeconds;
            live.HabitEarlySeconds = c.HabitEarlySeconds;
            live.Pause = c.Pause;
            if (!fresh.HabitLearningEnabled) live.Habits = null;
            fresh.ApplyTo(_profile);
            if (exitWasAllowed && !fresh.AllowUserExit)
            {
                string sid = WindowsIdentity.GetCurrent().User?.Value ?? "";
                string error = ProcessHardening.Apply(sid);
                AgentLog.Write(error == null ? "policy: exit now forbidden, process hardened" : "policy: hardening FAILED: " + error);
            }
            _icon.ContextMenuStrip = BuildMenu();
            AgentLog.Write("policy reloaded: " + after);
        }

        private static string Fingerprint(AppSettings s) => string.Join(";", new[]
        {
            "mode=" + s.ModePolicy, "exit=" + s.AllowUserExit, "holdMax=" + s.HoldMaxMinutes, "minLockIdle=" + s.MinLockIdleSeconds, "grace=" + s.ConfirmGraceSeconds,
            "cap=" + s.MaxLearnedHorizonMinutes, "pause=" + s.AllowUserPause + "/" + string.Join(",", s.PauseOptionsMinutes) + "/" + s.PauseBudgetMinutesPerDay + "/" + s.PauseKeepsConfirmation,
            "media=" + s.MediaHoldEnabled, "meeting=" + s.MeetingHoldEnabled, "habits=" + s.HabitLearningEnabled,
            "export=" + s.AllowProfileExport, "collect=" + (string.IsNullOrEmpty(s.ProfileExportDirectory) ? "off" : "on"),
            "retention=" + s.LogRetentionDays + "/" + s.ProtectedCopyRetentionDays + "/" + s.CollectedProfileRetentionDays,
            "thresholds=" + s.SoftDimThreshold + "/" + s.LockThreshold
        });

        private void ApplyHousekeepingResult()
        {
            var report = _hkResult;
            if (report == null) return;
            _hkResult = null;
            var st = _profile.Stats;
            st.HousekeepingRuns++;
            st.LastHousekeepingUtcTicks = DateTime.UtcNow.Ticks;
            st.JournalEpisodesRetired += report.JournalEpisodesRetired;
            st.FilesRetired += report.FilesDeleted.Count;
            st.LogLinesRetired += _hkLines;
            AgentLog.Write(report + ", log lines retired " + _hkLines);
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
                var protectedCopy = Guard.ProtectedStore.TryRead(sid);
                var chosen = TamperProtection.ChooseTrusted(profile, localExisted, protectedCopy,
                                                            sid, _settings.ModePolicy, out string reason);
                if (!ReferenceEquals(chosen, profile)) AgentLog.Write(reason);
                profile = chosen;
                TamperProtection.MergePauseLedger(profile, protectedCopy);   // an edited file cannot restore pause budget
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
                    // The baseline usually lives on a share: never let it hold up the agent's start.
                    string basePath = _settings.BaselineProfilePath;
                    var read = System.Threading.Tasks.Task.Run(() => BoundedFile.ReadAllText(basePath, BoundedFile.MaxProfileBytes));
                    if (!read.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("baseline not readable within 5 s");
                    var baseline = ProfileStore.ExportBaseline(ProfileStore.Deserialize(read.Result));
                    baseline.UserSid = sid;
                    baseline.MachineName = machine;
                    baseline.Origin = "seeded from baseline";
                    AgentLog.Write("seeded from baseline profile");
                    return baseline;
                }
                catch (Exception ex)
                {
                    AgentLog.Write("baseline unusable, starting fresh: " + ex.GetType().Name);
                }
            }
            long processStart = System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks;
            var p = ProfileStore.LoadWithRecovery(_profilePath, sid, machine, out string recovery, processStart);
            if (recovery != null)
                AgentEvents.Write(AgentEvents.ProfileRecovered, System.Diagnostics.EventLogEntryType.Warning, "PresenceLock: " + recovery);
            return p;
        }

        private static readonly string AgentVersion = AgentIdentity.Version;

        private void SaveProfile()
        {
            try
            {
                _profile.AppVersion = AgentVersion;                 // the version that wrote it, not the one that created it
                _profile.UpdatedUtcTicks = DateTime.UtcNow.Ticks;
                string json = ProfileStore.Serialize(_profile);
                string habits = _habits != null ? HabitStore.Serialize(_habits) : null;
                string path = _profilePath, habitsPath = HabitStore.DefaultPath();
                _io.Post("profile", () =>
                {
                    ProfileStore.WriteText(path, json);
                    if (habits != null) ProfileStore.WriteText(habitsPath, habits);
                });
                _lastSaveUtc = DateTime.UtcNow;
            }
            catch (Exception ex) { AgentLog.Write("save failed: " + ex.GetType().Name); }
        }

        private void MaybeExportToShare()
        {
            long done = System.Threading.Interlocked.Exchange(ref _exportDoneTicks, 0);
            if (done > 0) { _profile.Stats.LastExportSuccessUtcTicks = done; }
            else if (done < 0) { _profile.Stats.ExportFailures++; }

            if (string.IsNullOrEmpty(_settings.ProfileExportDirectory) || _exportInFlight) return;
            var st = _profile.Stats;
            long now = DateTime.UtcNow.Ticks;
            bool due = now - st.LastExportSuccessUtcTicks >= ExportEvery.Ticks;
            bool backoff = st.LastExportAttemptUtcTicks > st.LastExportSuccessUtcTicks && now - st.LastExportAttemptUtcTicks < TimeSpan.TicksPerHour;
            if (!due || backoff) return;
            st.LastExportAttemptUtcTicks = now;
            _exportInFlight = true;
            string dir = _settings.ProfileExportDirectory;
            string name = Sanitize(Environment.MachineName) + "_" + Sanitize(Environment.UserName) + ".json";
            string json = ProfileStore.Serialize(ProfileStore.ExportForCollection(_profile));   // allow-listed content
            _io.Post("export", () =>
            {
                try
                {
                    // Atomic publish: readers never see a half-written file.
                    Directory.CreateDirectory(dir);
                    string final = Path.Combine(dir, name), tmp = final + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    File.WriteAllText(tmp, json);
                    try
                    {
                        if (File.Exists(final)) File.Replace(tmp, final, null); else File.Move(tmp, final);
                    }
                    finally { if (File.Exists(tmp)) File.Delete(tmp); }
                    System.Threading.Interlocked.Exchange(ref _exportDoneTicks, DateTime.UtcNow.Ticks);
                }
                catch (Exception ex)
                {
                    AgentLog.Write("share export failed (retry in 1 h): " + ex.GetType().Name);
                    System.Threading.Interlocked.Exchange(ref _exportDoneTicks, -1);
                }
                finally { _exportInFlight = false; }
            });
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
            IdleSource.NoteRawInput();
            _kin.Feed(sample);
            // Instant visual feedback; the coordinator itself sees the input on the next tick
            // (idle < 1 s), before it could take any further action.
            if (_overlay.Visible) _overlay.Cancel();
        }

        private void OnTick(object sender, EventArgs e)
        {
            if (_shuttingDown) return;
            long now = Now();
            double idle = IdleSource.Read();
            if (IdleSource.Degraded) { _profile.Stats.IdleSignalFailures++; if (!_signalDegradedReported) ReportSignalDegraded("GetLastInputInfo failed: idle time now grows from the last good reading (fail-closed)"); }
            else if (_signalDegradedReported && _msg.RawInputRegistered && _msg.SessionNotificationsRegistered) { _signalDegradedReported = false; AgentLog.Write("signals restored"); }
            if (DateTime.UtcNow - _lastHeartbeatUtc >= TimeSpan.FromSeconds(5)) { _lastHeartbeatUtc = DateTime.UtcNow; AgentHeartbeat.Beat(); }
            if (DateTime.UtcNow - _lastRegistrationTryUtc >= TimeSpan.FromMinutes(1) && !(_msg.RawInputRegistered && _msg.SessionNotificationsRegistered))
            {
                _lastRegistrationTryUtc = DateTime.UtcNow;
                if (!_msg.EnsureRegistered()) { _profile.Stats.RegistrationFailures++; ReportSignalDegraded("registration still failing (error " + _msg.LastRegistrationError + ")"); }
            }
            if (DateTime.UtcNow - _lastPolicyReloadUtc >= PolicyReloadEvery) ReloadPolicy();
            ApplyHousekeepingResult();

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
            if (_pauseShown && !_coord.PauseActive(now)) PauseFinished(endedByUser: false);
            if (DateTime.UtcNow - _lastSaveUtc >= SaveEvery) SaveProfile();
            if (DateTime.UtcNow - _lastHousekeepingUtc >= RetentionPolicy.Interval) RunHousekeeping();
            MaybeExportToShare();
        }

        private void Act(CoordinatorResult r)
        {
            if (r.QualityChange == QualityMonitor.Change.Degraded)
                AgentEvents.Write(AgentEvents.QualityBelowTarget, System.Diagnostics.EventLogEntryType.Warning,
                    "PresenceLock quality below target: " + _profile.Quality.Describe(_profile.Modes) +
                    ". Locking continues; the model keeps adapting. Review with PresenceLock.exe --status.");
            else if (r.QualityChange == QualityMonitor.Change.Restored)
                AgentEvents.Write(AgentEvents.QualityRestored, System.Diagnostics.EventLogEntryType.Information,
                    "PresenceLock quality back within target: " + _profile.Quality.Describe(_profile.Modes));
            if (r.ModelRolledBack)
            {
                AgentEvents.Write(AgentEvents.ModelRolledBack, System.Diagnostics.EventLogEntryType.Information,
                    "PresenceLock rolled back a learned model change that predicted worse than the previous one: " +
                    _profile.Guard.Describe());
                SaveProfile();
            }

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
                    if (r.LockUnconfirmed)
                        AgentEvents.Write(AgentEvents.LockNotConfirmed, System.Diagnostics.EventLogEntryType.Warning,
                            "PresenceLock: lock requested again (attempt " + r.LockAttempt + ", cause " + r.Cause +
                            "): the previous request was refused or never confirmed by a session-lock event.");
                    if (!NativeMethods.LockWorkStation())
                    {
                        _coord.OnLockRefused();
                        AgentLog.Write("LockWorkStation refused (policy DisableLockWorkstation?); will retry, then disconnect");
                    }
                    break;

                case CoordinatorAction.Disconnect:
                    _overlay.Cancel();
                    bool ok = NativeMethods.WTSDisconnectSession(IntPtr.Zero, NativeMethods.WTS_CURRENT_SESSION, false);
                    AgentEvents.Write(AgentEvents.LockNotConfirmed, ok ? System.Diagnostics.EventLogEntryType.Warning : System.Diagnostics.EventLogEntryType.Error,
                        "PresenceLock: " + (r.LockAttempt - 1) + " lock requests not confirmed; fallback disconnect " +
                        (ok ? "initiated" : "FAILED (error " + System.Runtime.InteropServices.Marshal.GetLastWin32Error() + ")"), throttle: false);
                    if (!ok) _coord.OnDisconnectRefused();
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
            _coord.OnSessionLocked(Now(), IdleSource.Read(), _builder.BuildSignature);
            SaveProfile();
        }

        private void OnSessionUnlocked()
        {
            _coord.OnSessionUnlocked(Now());   // our own lock: quick unlock => FP, long => confirmed
            _kin.Clear();
            SaveProfile();
        }

        /// <summary>RDP client closed, network drop, or the console handed over to RDP: the session
        /// is not displayed anywhere and reconnecting requires authentication. No departure label.</summary>
        private void OnSessionDisconnected()
        {
            _overlay.Cancel();
            _coord.OnSessionDisconnected(Now(), IdleSource.Read());
            SaveProfile();
        }

        private void OnSessionConnected()
        {
            _coord.OnSessionConnected(Now());
            _kin.Clear();                      // console and RDP kinematics must not mix
        }

        private void OnSessionEnding(object sender, SessionEndingEventArgs e)
        {
            SaveProfile();
            _io.Flush(TimeSpan.FromSeconds(5));                  // logoff: the save must land on disk
        }

        // ------------------------------------------------------------------ tray menu

        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();

            // User pause: rebuilt each time the menu opens (budget and state change over time).
            var pause = new ToolStripMenuItem("Pausa");
            pause.DropDownItems.Add("(laddar)");
            menu.Opening += (s, e) => RebuildPauseMenu(pause);
            if (_settings.AllowUserPause && _settings.PauseBudgetMinutesPerDay > 0)
            {
                menu.Items.Add(pause);
                menu.Items.Add(new ToolStripSeparator());
            }

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

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Om PresenceLock…", null, (s, e) => ShowAbout());

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

        // ------------------------------------------------------------------ about

        private Ui.AboutForm _about;

        private void ShowAbout()
        {
            if (_about != null && !_about.IsDisposed) { _about.Activate(); return; }
            _about = new Ui.AboutForm(_settings.ToAboutInfo(AgentVersion), ProfileStore.DefaultDirectory());
            try { _about.ShowDialog(); }
            finally { _about.Dispose(); _about = null; }
        }

        // ------------------------------------------------------------------ user pause

        private bool _pauseShown;

        private void RebuildPauseMenu(ToolStripMenuItem pause)
        {
            pause.DropDownItems.Clear();
            long now = Now();
            var p = _coord.Config.Pause;
            var ledger = _profile.Pause;
            if (_coord.PauseActive(now))
            {
                pause.Text = "Pausad till " + Local(ledger.ActiveUntil(now));
                pause.DropDownItems.Add("Avsluta pausen nu", null, (s, e) =>
                {
                    _coord.EndPause(Now());
                    PauseFinished(endedByUser: true);
                });
                return;
            }
            pause.Text = "Pausa";
            double left = ledger.RemainingMinutes(now, p);
            foreach (int m in p.ValidOptions())
            {
                int minutes = m;
                var item = new ToolStripMenuItem(minutes + " minuter", null, (s, e) => StartPause(minutes));
                if (ledger.WhyNot(minutes, now, p) != null)
                {
                    item.Enabled = false;
                    long at = ledger.AvailableAt(minutes, now, p);
                    if (at != long.MaxValue) item.Text += "  (från " + Local(at) + ")";
                }
                pause.DropDownItems.Add(item);
            }
            pause.DropDownItems.Add(new ToolStripSeparator());
            pause.DropDownItems.Add(new ToolStripMenuItem("Kvar senaste dygnet: " + Math.Floor(left) + " av " + p.BudgetMinutesPer24h + " min") { Enabled = false });
            if (p.KeepConfirmation)
                pause.DropDownItems.Add(new ToolStripMenuItem("Under pausen frågar skärmen \"är du kvar?\" efter " +
                                                              _settings.HoldMaxMinutes + " min utan aktivitet") { Enabled = false });
        }

        private void StartPause(int minutes)
        {
            long now = Now();
            if (!_coord.TryStartPause(minutes, now, out string reason))
            {
                _icon.ShowBalloonTip(5000, "PresenceLock", "Pausen kunde inte startas: " + reason, ToolTipIcon.None);
                return;
            }
            _overlay.Cancel();
            _pauseShown = true;
            _icon.Text = "PresenceLock – pausad till " + Local(_profile.Pause.ActiveUntil(now));
            double left = _profile.Pause.RemainingMinutes(now, _coord.Config.Pause);
            AgentEvents.Write(AgentEvents.PauseStarted, System.Diagnostics.EventLogEntryType.Information,
                "PresenceLock paused by the user for " + minutes + " min (until " + Local(_profile.Pause.ActiveUntil(now)) +
                "); budget left in the last 24 h: " + Math.Floor(left) + " of " + _coord.Config.Pause.BudgetMinutesPer24h +
                " min; confirmation after HoldMax " + (_coord.Config.Pause.KeepConfirmation ? "kept" : "OFF (full pause)"), throttle: false);
            SaveProfile();
        }

        private void PauseFinished(bool endedByUser)
        {
            if (!_pauseShown) return;
            _pauseShown = false;
            _icon.Text = "PresenceLock";
            _icon.ShowBalloonTip(5000, "PresenceLock", endedByUser ? "Pausen är avslutad." : "Pausen är slut. Datorn låses igen när du går.", ToolTipIcon.None);
            AgentEvents.Write(AgentEvents.PauseEnded, System.Diagnostics.EventLogEntryType.Information,
                "PresenceLock pause ended " + (endedByUser ? "by the user" : "(time ran out)"), throttle: false);
            SaveProfile();
        }

        private static string Local(long utcTicks) =>
            new DateTime(utcTicks, DateTimeKind.Utc).ToLocalTime().ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture);

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
            _io.Flush(TimeSpan.FromSeconds(5));
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
