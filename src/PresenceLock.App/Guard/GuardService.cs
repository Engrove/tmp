using System;
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
        private Timer _timer;
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
                          EvLockFailed = 1003, EvStartFailed = 1004, EvProfileRestored = 1005, EvStop = 1009;

        private static void Event(string message, EventLogEntryType type, int id)
        {
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
        }

        protected override void OnStop()
        {
            _timer?.Dispose();
            Event("PresenceLock Guard stopped", EventLogEntryType.Warning, EvStop);
        }

        protected override void OnShutdown() => _timer?.Dispose();

        protected override void OnSessionChange(SessionChangeDescription d)
        {
            lock (_gate)
            {
                switch (d.Reason)
                {
                    case SessionChangeReason.SessionLogon: _policy.OnLogon(d.SessionId); break;
                    case SessionChangeReason.SessionLogoff: _policy.OnLogoff(d.SessionId); break;
                    case SessionChangeReason.SessionLock: _policy.OnLock(d.SessionId); break;
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
                    if (a.Kind == GuardActionKind.LockSession)
                    {
                        string result = SessionLauncher.LockSession(a.SessionId);
                        bool ok = !result.StartsWith("LOCK FAILED", StringComparison.Ordinal);
                        Event("Agent stopped unexpectedly in session " + a.SessionId + " (" + UserOf(a.SessionId) +
                              "): " + result, ok ? EventLogEntryType.Warning : EventLogEntryType.Error,
                              ok ? EvAgentKilledLocked : EvLockFailed);
                    }
                    else
                    {
                        try { SessionLauncher.StartInSession(a.SessionId, null); }
                        catch (Exception ex)
                        {
                            Event("Could not start agent in session " + a.SessionId + ": " + ex.Message,
                                  EventLogEntryType.Error, EvStartFailed);
                        }
                    }
                }

                if (DateTime.UtcNow - _lastSync >= ProfileSyncEvery)
                {
                    _lastSync = DateTime.UtcNow;
                    SyncProtectedProfiles();
                }
            }
            catch (Exception ex)
            {
                Event("guard tick failed: " + ex.Message, EventLogEntryType.Error, EvStartFailed);
            }
            finally { Monitor.Exit(_gate); }
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
                string local = Path.Combine(localAppData, "PresenceLock", "profile.json");
                if (!File.Exists(local)) continue;
                try
                {
                    var candidate = ProfileStore.Deserialize(File.ReadAllText(local, Encoding.UTF8));
                    var existing = ProtectedStore.TryRead(sid);
                    if (TamperProtection.AcceptIntoProtected(existing, candidate, sid, policy, out var reason))
                        ProtectedStore.Write(sid, candidate);
                    else if (existing != null)
                        Event("Profile change refused for " + sid + ": " + reason, EventLogEntryType.Warning, EvProfileRegression);
                }
                catch (Exception)
                {
                    // unreadable/corrupt local profile: keep the protected copy as it is
                }
            }
        }
    }
}
