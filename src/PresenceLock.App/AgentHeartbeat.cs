using System;
using Microsoft.Win32;

namespace PresenceLock.App
{
    /// <summary>
    /// Liveness signal from the agent's UI thread to the guard: HKCU\Software\PresenceLock\Agent,
    /// "Heartbeat" (UTC ticks, QWORD) and "Pid". Written every few seconds by the same timer that
    /// drives the security loop, so a hung UI thread stops it and the guard treats the agent as not
    /// responding (review F04). It proves liveness of a cooperating agent, not authenticity: the user
    /// can write the same key. Authenticity comes from the exact image path, the agent role and the
    /// process DACL that keeps a standard user from killing or suspending the agent.
    /// </summary>
    internal static class AgentHeartbeat
    {
        public const string KeyPath = @"Software\PresenceLock\Agent";
        public const string ValueName = "Heartbeat";

        public static void Beat()
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(KeyPath))
                {
                    k.SetValue(ValueName, DateTime.UtcNow.Ticks, RegistryValueKind.QWord);
                    k.SetValue("Pid", System.Diagnostics.Process.GetCurrentProcess().Id, RegistryValueKind.DWord);
                }
            }
            catch (Exception) { /* the guard will see a stale heartbeat */ }
        }
    }
}
