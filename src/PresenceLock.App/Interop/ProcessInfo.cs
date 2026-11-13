using System;
using System.Runtime.InteropServices;

namespace PresenceLock.App.Interop
{
    /// <summary>
    /// The ROLE of a PresenceLock.exe process. The same exe runs as agent (no arguments), as guard
    /// service (--service) and as CLI (--status, --probe-signals ...). Only the agent role protects a
    /// session, so a long-running CLI instance started by the user must never count as "agent running"
    /// (review F04). The command line is read with NtQueryInformationProcess(ProcessCommandLineInformation),
    /// Windows 8.1 and later, which needs only PROCESS_QUERY_LIMITED_INFORMATION.
    /// </summary>
    internal static class ProcessInfo
    {
        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, IntPtr buffer, int length, out int returnLength);

        private const int ProcessCommandLineInformation = 60;

        public static string TryGetCommandLine(int pid)
        {
            IntPtr h = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                NtQueryInformationProcess(h, ProcessCommandLineInformation, IntPtr.Zero, 0, out int len);
                if (len <= 0 || len > 1 << 16) return null;
                IntPtr buf = Marshal.AllocHGlobal(len);
                try
                {
                    if (NtQueryInformationProcess(h, ProcessCommandLineInformation, buf, len, out len) != 0) return null;
                    // UNICODE_STRING { USHORT Length; USHORT MaximumLength; PWSTR Buffer; } — Buffer at pointer alignment.
                    int bytes = (ushort)Marshal.ReadInt16(buf);
                    IntPtr text = Marshal.ReadIntPtr(buf, IntPtr.Size);
                    return text == IntPtr.Zero ? "" : Marshal.PtrToStringUni(text, bytes / 2);
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            finally { NativeMethods.CloseHandle(h); }
        }

        /// <summary>True if the command line has no arguments after the exe path (the agent role).</summary>
        public static bool IsAgentRole(string commandLine)
        {
            if (commandLine == null) return false;                       // unknown role: not proof of an agent
            string s = commandLine.Trim();
            int end;
            if (s.StartsWith("\"", StringComparison.Ordinal))
            {
                end = s.IndexOf('"', 1);
                if (end < 0) return false;
                end++;
            }
            else
            {
                end = s.IndexOfAny(new[] { ' ', '\t' });
                if (end < 0) return true;
            }
            return s.Substring(end).Trim().Length == 0;
        }
    }
}
