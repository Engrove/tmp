using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using PresenceLock.Core;

namespace PresenceLock.App.Interop
{
    /// <summary>
    /// Applies <see cref="TamperProtection.AgentProcessSddl"/> to the agent's own process object,
    /// so a standard user can no longer terminate, suspend or inject into it (Task Manager
    /// "End task", taskkill /F, Stop-Process all get "access denied"). Elevated administrators
    /// and SYSTEM keep full access. Only used when policy AllowUserExit = 0.
    /// </summary>
    internal static class ProcessHardening
    {
        private const uint DACL_SECURITY_INFORMATION = 0x00000004;
        private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
        private const uint SDDL_REVISION_1 = 1;

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
            string stringSecurityDescriptor, uint revision, out IntPtr securityDescriptor, out uint size);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetKernelObjectSecurity(IntPtr handle, uint securityInformation, IntPtr securityDescriptor);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr mem);

        /// <summary>Returns null on success, otherwise the reason (logged; the guard is the second line).</summary>
        public static string Apply(string userSid)
        {
            IntPtr sd = IntPtr.Zero;
            try
            {
                string sddl = TamperProtection.AgentProcessSddl(userSid);
                if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, SDDL_REVISION_1, out sd, out _))
                    return "SDDL conversion failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                if (!SetKernelObjectSecurity(GetCurrentProcess(),
                        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, sd))
                    return "SetKernelObjectSecurity failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                return null;
            }
            catch (ArgumentException ex)
            {
                return ex.Message;
            }
            finally
            {
                if (sd != IntPtr.Zero) LocalFree(sd);
            }
        }
    }
}
