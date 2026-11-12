using System;
using System.Collections.Generic;

namespace PresenceLock.Core
{
    /// <summary>
    /// Pure decision rules for tamper resistance ("NIS2 mode", GPO AllowUserExit = 0).
    /// The Windows-specific parts (process DACL, guard service, protected directory ACLs) only
    /// execute these rules; the rules themselves are unit-tested here.
    ///
    /// Threat model: a STANDARD (non-admin) user who wants their workstation to stay unlocked.
    /// Local administrators and physical attacks are out of scope by definition.
    /// </summary>
    public static class TamperProtection
    {
        public const uint PROCESS_TERMINATE = 0x00000001;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
        public const uint SYNCHRONIZE = 0x00100000;
        public const uint PROCESS_ALL_ACCESS = 0x001FFFFF;

        /// <summary>
        /// Security descriptor (SDDL) for the agent's OWN process object:
        ///   D:P                  protected DACL (nothing inherited)
        ///   SY, BA               full access (SYSTEM, the guard service; elevated administrators)
        ///   OW  (OWNER RIGHTS)   only SYNCHRONIZE | QUERY_LIMITED — this REMOVES the owner's
        ///                        implicit READ_CONTROL/WRITE_DAC, so the user cannot rewrite the
        ///                        DACL to grant themselves terminate rights
        ///   user SID             only SYNCHRONIZE | QUERY_LIMITED — no PROCESS_TERMINATE, no
        ///                        suspend, no VM read/write, no thread injection
        /// Task Manager "End task", taskkill /F and Stop-Process then get "access denied" for a
        /// standard user. Explicit access masks are used, never GENERIC_* bits.
        /// </summary>
        public static string AgentProcessSddl(string userSid)
        {
            if (string.IsNullOrEmpty(userSid) || !userSid.StartsWith("S-1-", StringComparison.Ordinal))
                throw new ArgumentException("a SID string (S-1-...) is required", nameof(userSid));
            foreach (char c in userSid)
                if (!(char.IsDigit(c) || c == '-' || c == 'S'))
                    throw new ArgumentException("invalid SID string", nameof(userSid));

            string full = "0x" + PROCESS_ALL_ACCESS.ToString("x");
            string limited = "0x" + (SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION).ToString("x");
            return "D:P"
                 + "(A;;" + full + ";;;SY)"
                 + "(A;;" + full + ";;;BA)"
                 + "(A;;" + limited + ";;;OW)"
                 + "(A;;" + limited + ";;;" + userSid + ")";
        }

        /// <summary>
        /// Everything in the profile that is POLICY rather than LEARNED state is reset to
        /// built-in defaults, so editing the user-writable profile.json cannot raise thresholds,
        /// stretch the learning period, freeze learning or move the certain-absence horizon.
        /// GPO values are applied afterwards (AppSettings.ApplyTo). Learned weights, counters,
        /// the outcome window and the mode are kept (the mode is checked by ChooseTrusted).
        /// </summary>
        public static void ResetPolicyFields(UserProfile p)
        {
            var defaults = new UserProfile();
            p.Config = defaults.Config;

            p.Modes.MinLearningDays = defaults.Modes.MinLearningDays;
            p.Modes.MaxLearningDays = defaults.Modes.MaxLearningDays;
            p.Modes.TargetFalsePositiveRate = defaults.Modes.TargetFalsePositiveRate;
            p.Modes.MinConfirmedPositives = defaults.Modes.MinConfirmedPositives;

            p.Model.LearningRate = defaults.Model.LearningRate;
            p.Model.L2 = defaults.Model.L2;
            p.Model.GradClip = defaults.Model.GradClip;
            p.Model.RateParamClip = defaults.Model.RateParamClip;

            // Non-finite weights would make every probability NaN (never >= threshold).
            if (!Finite(p.Model.W0) || !Finite(p.Model.U0) || !AllFinite(p.Model.W) || !AllFinite(p.Model.U))
            {
                p.Model = defaults.Model;
            }
        }

        private static bool Finite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);
        private static bool AllFinite(double[] a)
        {
            if (a == null) return false;
            foreach (var v in a) if (!Finite(v)) return false;
            return true;
        }

        /// <summary>
        /// Agent start: decide between the user-writable local profile and the guard's protected
        /// copy (readable by the user, writable only by SYSTEM/administrators).
        /// The protected copy wins when the local one is missing, regressed from Enforcing to
        /// Learning, or claims a later learning start (which would restart the 15-day clock) —
        /// unless policy forces learning (an administrator's decision, not tampering).
        /// </summary>
        public static UserProfile ChooseTrusted(UserProfile local, bool localExisted, UserProfile protectedCopy,
                                                string userSid, ModePolicy policy, out string reason)
        {
            reason = "local";
            if (protectedCopy == null) return local;
            if (!string.Equals(protectedCopy.UserSid, userSid, StringComparison.OrdinalIgnoreCase))
            {
                reason = "protected copy belongs to another user: ignored";
                return local;
            }
            if (policy == ModePolicy.ForceLearning) return local;

            if (!localExisted)
            {
                reason = "local profile missing: restored from protected copy";
                return protectedCopy;
            }
            if (protectedCopy.Modes.Mode == OperatingMode.Enforcing && local.Modes.Mode != OperatingMode.Enforcing)
            {
                reason = "local profile regressed to Learning: restored from protected copy";
                return protectedCopy;
            }
            long pf = protectedCopy.Modes.FirstSeenUtcTicks, lf = local.Modes.FirstSeenUtcTicks;
            if (pf != 0 && (lf == 0 || pf < lf))
            {
                reason = "local profile restarted the learning clock: restored from protected copy";
                return protectedCopy;
            }
            return local;
        }

        /// <summary>
        /// Guard service: may this candidate (read from the user's local profile) replace the
        /// protected copy? Monotonic: never accept a step back from Enforcing to Learning, or a
        /// later learning start, unless policy forces learning.
        /// </summary>
        public static bool AcceptIntoProtected(UserProfile existing, UserProfile candidate, string userSid,
                                               ModePolicy policy, out string reason)
        {
            reason = "accepted";
            if (candidate == null) { reason = "unreadable"; return false; }
            if (candidate.SchemaVersion != UserProfile.CurrentSchemaVersion) { reason = "schema mismatch"; return false; }
            if (!string.Equals(candidate.UserSid, userSid, StringComparison.OrdinalIgnoreCase))
            {
                reason = "profile SID does not match the session user";
                return false;
            }
            if (existing == null || policy == ModePolicy.ForceLearning) return true;

            if (existing.Modes.Mode == OperatingMode.Enforcing && candidate.Modes.Mode != OperatingMode.Enforcing)
            {
                reason = "regression Enforcing -> Learning refused";
                return false;
            }
            long ef = existing.Modes.FirstSeenUtcTicks, cf = candidate.Modes.FirstSeenUtcTicks;
            if (ef != 0 && (cf == 0 || cf > ef))
            {
                reason = "learning clock restart refused";
                return false;
            }
            return true;
        }
    }

    // ------------------------------------------------------------------- guard service rules

    public enum GuardActionKind { StartAgent, LockSession }

    public struct GuardAction
    {
        public int SessionId;
        public GuardActionKind Kind;
        public override string ToString() => Kind + "@" + SessionId;
    }

    public struct SessionSnapshot
    {
        public int SessionId;
        public bool Active;          // WTSActive: a user is logged on and connected
        public bool AgentRunning;    // a PresenceLock agent process exists in that session
    }

    /// <summary>
    /// The guard service's per-session state machine (polled every ~2 s by the LocalSystem
    /// service). It (re)starts the agent in every active session and, in fail-closed mode,
    /// LOCKS a session whose agent disappeared while the session was unlocked — so killing or
    /// crashing the agent can never leave a workstation open.
    /// </summary>
    public sealed class GuardPolicy
    {
        /// <summary>Consecutive polls without an agent before acting (debounces process restarts).</summary>
        public int MissesBeforeAction = 2;

        private sealed class State
        {
            public bool Seen;     // an agent has been observed running in this session
            public int Misses;
            public bool Locked;   // session currently locked (from session-change events)
            public bool Ending;   // logoff in progress
        }

        private readonly Dictionary<int, State> _sessions = new Dictionary<int, State>();

        private State Get(int id)
        {
            if (!_sessions.TryGetValue(id, out var s)) { s = new State(); _sessions[id] = s; }
            return s;
        }

        public void OnLogon(int sessionId) => _sessions[sessionId] = new State();
        public void OnLogoff(int sessionId) => Get(sessionId).Ending = true;
        public void OnLock(int sessionId) => Get(sessionId).Locked = true;
        public void OnUnlock(int sessionId) => Get(sessionId).Locked = false;

        public List<GuardAction> Evaluate(IEnumerable<SessionSnapshot> sessions, bool failClosed)
        {
            var actions = new List<GuardAction>();
            var present = new HashSet<int>();
            foreach (var snap in sessions)
            {
                present.Add(snap.SessionId);
                if (!snap.Active || snap.SessionId == 0) continue;     // session 0 = services
                var st = Get(snap.SessionId);
                if (st.Ending) continue;

                if (snap.AgentRunning)
                {
                    st.Seen = true;
                    st.Misses = 0;
                    continue;
                }
                if (++st.Misses < MissesBeforeAction) continue;

                if (failClosed && st.Seen && !st.Locked)
                {
                    actions.Add(new GuardAction { SessionId = snap.SessionId, Kind = GuardActionKind.LockSession });
                    st.Locked = true;
                }
                actions.Add(new GuardAction { SessionId = snap.SessionId, Kind = GuardActionKind.StartAgent });
                st.Seen = false;
                st.Misses = 0;
            }
            // Forget sessions that no longer exist.
            var gone = new List<int>();
            foreach (var id in _sessions.Keys) if (!present.Contains(id)) gone.Add(id);
            foreach (var id in gone) _sessions.Remove(id);
            return actions;
        }
    }
}
