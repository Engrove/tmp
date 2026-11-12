using System;
using System.Linq;
using Microsoft.Win32;
using PresenceLock.Core;

namespace PresenceLock.App.Settings
{
    /// <summary>
    /// Reads settings from the registry locations that Group Policy manages. Value names and
    /// types match deploy/PresenceLock.admx exactly.
    ///
    ///   HKCU\Software\PresenceLock               user preference (only ShowLockNotification)
    ///   HKCU\Software\Policies\PresenceLock      user-scope GPO
    ///   HKLM\Software\Policies\PresenceLock      computer-scope GPO (wins)
    ///
    /// The process is AnyCPU without Prefer32Bit, so on 64-bit Windows it reads the 64-bit
    /// registry view, which is where Group Policy writes.
    /// </summary>
    internal static class PolicyReader
    {
        public const string PolicyKey = @"SOFTWARE\Policies\PresenceLock";
        public const string PreferenceKey = @"SOFTWARE\PresenceLock";

        public static AppSettings Load()
        {
            var s = new AppSettings();
            Apply(s, Registry.CurrentUser, PreferenceKey, isPolicy: false);
            Apply(s, Registry.CurrentUser, PolicyKey, isPolicy: true);
            Apply(s, Registry.LocalMachine, PolicyKey, isPolicy: true);
            return s;
        }

        /// <summary>Persist the user's own "Visa låsning" choice (ignored if policy sets it).</summary>
        public static void SaveShowLockNotificationPreference(bool value)
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(PreferenceKey))
                    k?.SetValue("ShowLockNotification", value ? 1 : 0, RegistryValueKind.DWord);
            }
            catch (Exception ex) { AgentLog.Write("pref save failed: " + ex.GetType().Name); }
        }

        private static void Apply(AppSettings s, RegistryKey hive, string path, bool isPolicy)
        {
            try
            {
                using (var k = hive.OpenSubKey(path, false))
                {
                    if (k == null) return;

                    int? v = Dword(k, "ShowLockNotification");
                    if (v.HasValue)
                    {
                        s.ShowLockNotification = v.Value != 0;
                        if (isPolicy) s.ShowLockNotificationLocked = true;
                    }
                    if (!isPolicy) return; // everything below is administrator-only

                    if ((v = Dword(k, "ModePolicy")).HasValue)
                        s.ModePolicy = (ModePolicy)Math.Max(0, Math.Min(2, v.Value));
                    if ((v = Dword(k, "EnableAudioSonar")).HasValue) s.EnableAudioSonar = v.Value != 0;
                    if ((v = Dword(k, "EnableBleRssi")).HasValue) s.EnableBleRssi = v.Value != 0;
                    if ((v = Dword(k, "SoftDimThresholdPercent")).HasValue) s.SoftDimThreshold = Pct(v.Value, 50, 99);
                    if ((v = Dword(k, "LockThresholdPercent")).HasValue) s.LockThreshold = Pct(v.Value, 50, 99);
                    if ((v = Dword(k, "MinLearningDays")).HasValue) s.MinLearningDays = Math.Max(1, Math.Min(365, v.Value));
                    if ((v = Dword(k, "MaxLearningDays")).HasValue) s.MaxLearningDays = Math.Max(1, Math.Min(365, v.Value));
                    if ((v = Dword(k, "TargetFalsePositivePercent")).HasValue) s.TargetFalsePositiveRate = Pct(v.Value, 1, 50);
                    if ((v = Dword(k, "AllowUserExit")).HasValue) s.AllowUserExit = v.Value != 0;
                    if ((v = Dword(k, "AllowProfileExport")).HasValue) s.AllowProfileExport = v.Value != 0;

                    string str;
                    if ((str = Str(k, "ExtraReadingApps")) != null) s.ExtraReadingApps = Csv(str);
                    if ((str = Str(k, "ExtraLeavingApps")) != null) s.ExtraLeavingApps = Csv(str);
                    if ((str = Str(k, "ProfileExportDirectory")) != null) s.ProfileExportDirectory = Environment.ExpandEnvironmentVariables(str);
                    if ((str = Str(k, "BaselineProfilePath")) != null) s.BaselineProfilePath = Environment.ExpandEnvironmentVariables(str);
                }
            }
            catch (Exception ex)
            {
                // Unreadable policy must never stop the agent; defaults stay in force.
                AgentLog.Write("policy read failed (" + path + "): " + ex.GetType().Name);
            }
        }

        private static int? Dword(RegistryKey k, string name)
        {
            object o = k.GetValue(name);
            if (o is int i) return i;
            return null;
        }

        private static string Str(RegistryKey k, string name)
        {
            object o = k.GetValue(name);
            var s = o as string;
            return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        }

        private static double Pct(int value, int lo, int hi) => Math.Max(lo, Math.Min(hi, value)) / 100.0;

        private static string[] Csv(string s) =>
            s.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
             .Select(x => x.Trim())
             .Select(x => x.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? x.Substring(0, x.Length - 4) : x)
             .Where(x => x.Length > 0)
             .ToArray();
    }
}
