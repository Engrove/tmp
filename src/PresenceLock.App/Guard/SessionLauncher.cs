using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using PresenceLock.Core;

namespace PresenceLock.App.Guard
{
    /// <summary>
    /// Win32 plumbing for the guard service (runs as LocalSystem in session 0): enumerate
    /// interactive sessions, start a process as the logged-on user inside a given session,
    /// lock a session, and resolve the user's SID and LocalAppData folder from their token.
    /// All APIs are documented; WTSQueryUserToken requires SE_TCB_NAME, which LocalSystem has.
    /// </summary>
    internal static class SessionLauncher
    {
        // ---------------------------------------------------------------- P/Invoke
        private static readonly IntPtr WTS_CURRENT_SERVER_HANDLE = IntPtr.Zero;

        private enum WTS_CONNECTSTATE_CLASS
        {
            WTSActive, WTSConnected, WTSConnectQuery, WTSShadow, WTSDisconnected,
            WTSIdle, WTSListen, WTSReset, WTSDown, WTSInit
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WTS_SESSION_INFO
        {
            public int SessionId;
            [MarshalAs(UnmanagedType.LPWStr)] public string pWinStationName;
            public WTS_CONNECTSTATE_CLASS State;
        }

        [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version,
            out IntPtr sessionInfo, out int count);

        [DllImport("wtsapi32.dll")]
        private static extern void WTSFreeMemory(IntPtr memory);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSQueryUserToken(int sessionId, out IntPtr token);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WTSDisconnectSession(IntPtr server, int sessionId, [MarshalAs(UnmanagedType.Bool)] bool wait);

        private const uint MAXIMUM_ALLOWED = 0x02000000;
        private const int SecurityImpersonation = 2;
        private const int TokenPrimary = 1;

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DuplicateTokenEx(IntPtr existing, uint access, IntPtr attributes,
            int impersonationLevel, int tokenType, out IntPtr newToken);

        [DllImport("userenv.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token,
            [MarshalAs(UnmanagedType.Bool)] bool inherit);

        [DllImport("userenv.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DestroyEnvironmentBlock(IntPtr environment);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess, hThread;
            public int dwProcessId, dwThreadId;
        }

        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessAsUser(IntPtr token, string applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags, IntPtr environment, string currentDirectory,
            ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("shell32.dll")]
        private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid folderId,
            uint flags, IntPtr token, out IntPtr path);

        private static readonly Guid FOLDERID_LocalAppData = new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091");

        // ---------------------------------------------------------------- API

        public static readonly string AgentExePath = ResolveOwnPath();

        private static string ResolveOwnPath()
        {
            using (var me = Process.GetCurrentProcess()) return me.MainModule.FileName;
        }

        private static string ImagePath(int pid)
        {
            IntPtr h = Interop.NativeMethods.OpenProcess(Interop.NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                uint len = (uint)sb.Capacity;
                return Interop.NativeMethods.QueryFullProcessImageName(h, 0, sb, ref len) ? sb.ToString() : null;
            }
            finally { CloseHandle(h); }
        }

        /// <summary>
        /// All sessions, with whether a GENUINE agent runs in each. A process only counts if its
        /// full image path is the installed exe: a user-started copy renamed "PresenceLock.exe"
        /// in some writable folder must not satisfy the guard.
        /// </summary>
        public static List<SessionSnapshot> Snapshot()
        {
            var result = new List<SessionSnapshot>();
            var agentSessions = new HashSet<int>();
            int ownPid;
            using (var me = Process.GetCurrentProcess()) ownPid = me.Id;
            foreach (var p in Process.GetProcessesByName("PresenceLock"))
            {
                try
                {
                    if (p.Id != ownPid &&
                        string.Equals(ImagePath(p.Id), AgentExePath, StringComparison.OrdinalIgnoreCase))
                        agentSessions.Add(p.SessionId);
                }
                finally { p.Dispose(); }
            }

            if (!WTSEnumerateSessions(WTS_CURRENT_SERVER_HANDLE, 0, 1, out IntPtr buffer, out int count))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
                for (int i = 0; i < count; i++)
                {
                    var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(buffer + i * size);
                    result.Add(new SessionSnapshot
                    {
                        SessionId = info.SessionId,
                        Active = info.State == WTS_CONNECTSTATE_CLASS.WTSActive,
                        AgentRunning = agentSessions.Contains(info.SessionId)
                    });
                }
            }
            finally { WTSFreeMemory(buffer); }
            return result;
        }

        /// <summary>Start PresenceLock.exe [arguments] as the session's user, on its interactive desktop.</summary>
        public static void StartInSession(int sessionId, string arguments)
        {
            IntPtr userToken = IntPtr.Zero, primary = IntPtr.Zero, env = IntPtr.Zero;
            try
            {
                if (!WTSQueryUserToken(sessionId, out userToken))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken");
                if (!DuplicateTokenEx(userToken, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out primary))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "DuplicateTokenEx");
                if (!CreateEnvironmentBlock(out env, primary, false))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateEnvironmentBlock");

                string exe = AgentExePath;
                var cmd = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(arguments) ? "" : " " + arguments));
                var si = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), lpDesktop = @"winsta0\default" };
                if (!CreateProcessAsUser(primary, exe, cmd, IntPtr.Zero, IntPtr.Zero, false,
                        CREATE_UNICODE_ENVIRONMENT, env, System.IO.Path.GetDirectoryName(exe), ref si, out var pi))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser");
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
            }
            finally
            {
                if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
                if (primary != IntPtr.Zero) CloseHandle(primary);
                if (userToken != IntPtr.Zero) CloseHandle(userToken);
            }
        }

        /// <summary>
        /// Lock a session: run "PresenceLock.exe --lock-now" as its user (normal lock screen);
        /// if that fails, disconnect the session, which also returns a console session to the
        /// logon screen without logging the user off.
        /// </summary>
        public static string LockSession(int sessionId)
        {
            try
            {
                StartInSession(sessionId, "--lock-now");
                return "locked via LockWorkStation";
            }
            catch (Win32Exception ex)
            {
                if (WTSDisconnectSession(WTS_CURRENT_SERVER_HANDLE, sessionId, false))
                    return "LockWorkStation launch failed (" + ex.Message + "); session disconnected instead";
                return "LOCK FAILED: " + ex.Message + "; disconnect error " + Marshal.GetLastWin32Error();
            }
        }

        /// <summary>The session user's SID and LocalAppData folder (from their own token).</summary>
        public static bool TryGetUser(int sessionId, out string sid, out string localAppData)
        {
            sid = null; localAppData = null;
            if (!WTSQueryUserToken(sessionId, out IntPtr token)) return false;
            try
            {
                using (var id = new WindowsIdentity(token)) sid = id.User?.Value;
                if (SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, token, out IntPtr p) == 0)
                {
                    localAppData = Marshal.PtrToStringUni(p);
                    Marshal.FreeCoTaskMem(p);
                }
                return sid != null && localAppData != null;
            }
            finally { CloseHandle(token); }
        }
    }
}
