using System;
using System.Linq;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using Microsoft.Win32;
using PresenceLock.Core;

namespace PresenceLock.App.Guard
{
    /// <summary>
    /// "PresenceLock Guard" — a LocalSystem service (same exe, started with --service).
    /// Standard users cannot stop it (default service DACL), cannot kill it (SYSTEM process)
    /// and cannot replace it (Program Files).
    ///
    /// Every 2 s it applies <see cref="GuardPolicy"/>:
    ///  * an active session without a genuine agent  -> start the agent as that user;
    ///  * fail-closed (computer policy AllowUserExit = 0) and the agent DISAPPEARED from an
    ///    unlocked session -> lock that session first, then restart the agent.
    /// Every 60 s it refreshes the protected profile copy of each logged-on user
    /// (<see cref="TamperProtection.AcceptIntoProtected"/>: monotonic, no regressions).
    /// Tamper events go to the Application event log (source "PresenceLock") for SIEM.
    /// </summary>
    internal sealed class GuardService : ServiceBase
    {
        public const string Name = "PresenceLockGuard";
        private const string EventSource = "PresenceLock";
        private static readonly TimeSpan Poll = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan ProfileSyncEvery = TimeSpan.FromSeconds(60);

        private readonly GuardPolicy _policy = new GuardPolicy();
        private readonly object _gate = new object();
        private readonly object _ioGate = new object();
        private Timer _timer;
        private Timer _ioTimer;                  // profile sync and retention: never on the lock loop (review F05)
        private DateTime _lastSync = DateTime.MinValue;

        public GuardService()
        {
            ServiceName = Name;
            CanStop = true;
            CanHandleSessionChangeEvent = true;
            CanShutdown = true;
            AutoLog = false;
        }

        // Event IDs (stable, for SIEM rules)
        private const int EvStart = 1000, EvAgentKilledLocked = 1001, EvProfileRegression = 1002,
                          EvLockFailed = 1003, EvStartFailed = 1004, EvProfileRestored = 1005, EvRetention = 1006,
                          EvLockFallback = 1007, EvLockConfirmed = 1008, EvStop = 1009;
        private DateTime _lastRetention = DateTime.MinValue;

        private static readonly EventThrottle Throttle = new EventThrottle();

        /// <summary>
        /// Rate-limited per (id, key): a persistent failure (agent cannot start, a user keeps
        /// re-writing a refused profile) must not flood the Application log and push other
        /// security events out of it. Lock events (1001/1003) are limited per session to one a
        /// minute, everything else to one an hour; the next entry reports how many were suppressed.
        /// </summary>
        private static void Event(string message, EventLogEntryType type, int id, string key = "")
        {
            bool lockChain = id == EvAgentKilledLocked || id == EvLockFailed || id == EvLockFallback || id == EvLockConfirmed;
            var window = lockChain ? TimeSpan.FromMinutes(1) : TimeSpan.FromHours(1);
            if (!Throttle.ShouldEmit(id + "|" + key, DateTime.UtcNow.Ticks, window, out int suppressed)) return;
            message = EventThrottle.WithSuppressed(message, suppressed, window);
            try
            {
                if (!EventLog.SourceExists(EventSource)) EventLog.CreateEventSource(EventSource, "Application");
                EventLog.WriteEntry(EventSource, message, type, id);
            }
            catch (Exception) { /* event log unavailable: never let logging stop the guard */ }
        }

        protected override void OnStart(string[] args)
        {
            try { ProtectedStore.EnsureDirectory(); }
            catch (Exception ex) { Event("protected store unavailable: " + ex.Message, EventLogEntryType.Error, EvStart); }
            Event("PresenceLock Guard started (fail-closed=" + FailClosed() + ")", EventLogEntryType.Information, EvStart);
            _timer = new Timer(_ => Tick(), null, TimeSpan.Zero, Poll);
            _ioTimer = new Timer(_ => IoTick(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
        }

        protected override void OnStop()
        {
            _timer?.Dispose();
            _ioTimer?.Dispose();
            Event("PresenceLock Guard stopped", EventLogEntryType.Warning, EvStop);
        }

        protected override void OnShutdown() { _timer?.Dispose(); _ioTimer?.Dispose(); }

        protected override void OnSessionChange(SessionChangeDescription d)
        {
            lock (_gate)
            {
                switch (d.Reason)
                {
                    case SessionChangeReason.SessionLogon: _policy.OnLogon(d.SessionId); break;
                    case SessionChangeReason.SessionLogoff: _policy.OnLogoff(d.SessionId); break;
                    case SessionChangeReason.SessionLock:
                        if (_policy.LockPending(d.SessionId))
                            Event("Session " + d.SessionId + " (" + UserOf(d.SessionId) + ") is now locked, as requested by the guard (confirmed by Windows).",
                                  EventLogEntryType.Information, EvLockConfirmed, "s" + d.SessionId);
                        _policy.OnLock(d.SessionId);
                        break;
                    case SessionChangeReason.SessionUnlock: _policy.OnUnlock(d.SessionId); break;
                }
            }
        }

        /// <summary>Computer policy only: a user-scope policy must not be able to relax the guard.</summary>
        private static bool FailClosed()
        {
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(Settings.PolicyReader.PolicyKey, false))
                    return k?.GetValue("AllowUserExit") is int v && v == 0;
            }
            catch (Exception) { return false; }
        }

        private static ModePolicy MachineModePolicy()
        {
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(Settings.PolicyReader.PolicyKey, false))
                    return k?.GetValue("ModePolicy") is int v ? (ModePolicy)Math.Max(0, Math.Min(2, v)) : ModePolicy.Auto;
            }
            catch (Exception) { return ModePolicy.Auto; }
        }

        private void Tick()
        {
            if (!Monitor.TryEnter(_gate)) return;      // never overlap
            try
            {
                bool failClosed = FailClosed();
                foreach (var a in _policy.Evaluate(SessionLauncher.Snapshot(), failClosed))
                {
                    string detail;
                    bool requested;
                    switch (a.Kind)
                    {
                        case GuardActionKind.LockSession:
                            // A REQUEST: the session counts as locked only when Windows reports it.
                            requested = SessionLauncher.RequestLock(a.SessionId, out detail);
                            _policy.OnLockAttemptResult(a.SessionId, requested);
                            Event("Session " + a.SessionId + " (" + UserOf(a.SessionId) + "): " + a.Reason + "; lock requested (attempt " +
                                  a.Attempt + "): " + detail + ". Not yet confirmed by Windows.",
                                  requested ? EventLogEntryType.Warning : EventLogEntryType.Error,
                                  requested ? EvAgentKilledLocked : EvLockFailed, "s" + a.SessionId);
                            break;
                        case GuardActionKind.DisconnectSession:
                            requested = SessionLauncher.RequestDisconnect(a.SessionId, out detail);
                            _policy.OnLockAttemptResult(a.SessionId, requested);
                            Event("Session " + a.SessionId + " (" + UserOf(a.SessionId) + "): lock still not confirmed after " +
                                  (a.Attempt - 1) + " requests; fallback disconnect: " + detail,
                                  requested ? EventLogEntryType.Warning : EventLogEntryType.Error, EvLockFallback, "s" + a.SessionId);
                            break;
                        default:
                            try { SessionLauncher.StartInSession(a.SessionId, null); }
                            catch (Exception ex)
                            {
                                Event("Could not start agent in session " + a.SessionId + ": " + ex.Message,
                                      EventLogEntryType.Error, EvStartFailed, "s" + a.SessionId);
                            }
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                Event("guard tick failed: " + ex.Message, EventLogEntryType.Error, EvStartFailed);
            }
            finally { Monitor.Exit(_gate); }
        }

        /// <summary>
        /// Profile sync (every 60 s) and retention (every 24 h) on their own timer: a slow or
        /// unreachable share or disk can delay these, never the session/lock loop above.
        /// </summary>
        private void IoTick()
        {
            if (!Monitor.TryEnter(_ioGate)) return;
            try
            {
                if (DateTime.UtcNow - _lastSync >= ProfileSyncEvery)
                {
                    _lastSync = DateTime.UtcNow;
                    SyncProtectedProfiles();
                }
                if (DateTime.UtcNow - _lastRetention >= RetentionPolicy.Interval)
                {
                    _lastRetention = DateTime.UtcNow;
                    RetireOldData();
                }
            }
            catch (Exception ex) { Event("guard I/O tick failed: " + ex.Message, EventLogEntryType.Error, EvStartFailed, "io"); }
            finally { Monitor.Exit(_ioGate); }
        }

        /// <summary>
        /// Guard side of the cleaning service (every 24 h): protected copies of users who have not
        /// logged on for ProtectedCopyRetentionDays (active users' copies are rewritten every minute),
        /// crash leftovers in the state folder, and THIS computer's files in the collection share
        /// older than CollectedProfileRetentionDays (needs modify rights for the computer account on
        /// the share; without them it is skipped and retried tomorrow).
        /// </summary>
        private static void RetireOldData()
        {
            var settings = Settings.PolicyReader.Load();
            var r = settings.ToRetentionPolicy();
            var report = new HousekeepingReport();
            var now = DateTime.UtcNow;
            try
            {
                foreach (var f in Housekeeping.Expired(ProtectedStore.Directory_, "S-*.json", now, r.ProtectedCopyRetentionDays))
                    Housekeeping.TryDelete(f, true, report);
                foreach (var f in Housekeeping.Expired(ProtectedStore.Directory_, "*.tmp", now, 1))
                    Housekeeping.TryDelete(f, true, report);
            }
            catch (Exception) { /* next run */ }
            try
            {
                if (!string.IsNullOrEmpty(settings.ProfileExportDirectory))
                    foreach (var f in Housekeeping.Expired(settings.ProfileExportDirectory, Environment.MachineName + "_*.json", now, r.CollectedProfileRetentionDays))
                        Housekeeping.TryDelete(f, true, report);
            }
            catch (Exception) { /* share unreachable or no rights: next run */ }
            if (report.FilesDeleted.Count > 0)
                Event("PresenceLock retention: retired " + report.FilesDeleted.Count + " file(s) older than their retention: " +
                      string.Join(", ", report.FilesDeleted.Select(Path.GetFileName)), EventLogEntryType.Information, EvRetention);
        }

        private static bool IsLink(string path)
        {
            try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
            catch (Exception) { return true; }                  // unreadable attributes: do not trust it
        }

        private static string UserOf(int sessionId) =>
            SessionLauncher.TryGetUser(sessionId, out var sid, out _) ? sid : "unknown user";

        private static void SyncProtectedProfiles()
        {
            var policy = MachineModePolicy();
            foreach (var s in SessionLauncher.Snapshot())
            {
                if (!s.Active || s.SessionId == 0) continue;
                if (!SessionLauncher.TryGetUser(s.SessionId, out var sid, out var localAppData)) continue;
                // Retention counts from when the user was last SEEN, not from the last accepted
                // write: a user whose tampered profile is refused every minute must never outlive
                // their own protected copy (deleting it would let the tampered profile in).
                ProtectedStore.Touch(sid);
                string local = Path.Combine(localAppData, "PresenceLock", "profile.json");
                if (!File.Exists(local)) continue;
                try
                {
                    // SYSTEM reads a file in a user-writable folder: read it WITH THE USER'S OWN RIGHTS
                    // (impersonation), so a junction or symlink can only lead to files the user could
                    // read anyway (review F26); links are refused as well, and anything oversized.
                    if (IsLink(local) || IsLink(Path.GetDirectoryName(local))) continue;
                    string json = SessionLauncher.AsSessionUser(s.SessionId, () => BoundedFile.ReadAllText(local, BoundedFile.MaxProfileBytes));
                    var candidate = ProfileStore.Deserialize(json);
                    var existing = ProtectedStore.TryRead(sid);
                    if (TamperProtection.AcceptIntoProtected(existing, candidate, sid, policy, out var reason))
                    {
                        TamperProtection.MergePauseLedger(candidate, existing);   // pause budget can only grow, never be reset by editing
                        ProtectedStore.Write(sid, candidate);
                    }
                    else if (existing != null)
                        Event("Profile change refused for " + sid + ": " + reason, EventLogEntryType.Warning, EvProfileRegression, sid);
                }
                catch (Exception)
                {
                    // unreadable/corrupt local profile: keep the protected copy as it is
                }
            }
        }
    }
}
