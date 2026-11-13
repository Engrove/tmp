using System;
using System.Collections.Generic;

namespace PresenceLock.Core
{
    /// <summary>
    /// Which policy values may come from the USER scope (HKCU\Software\Policies\PresenceLock) at all.
    /// Everything that decides protection — mode, thresholds, hold limits, pause, retention, exit,
    /// export, collection, app lists, the About texts — is read from the COMPUTER policy only, so a
    /// value written into the user's own hive can never weaken what the computer policy leaves unset.
    /// The user scope may only carry documented user preferences.
    /// </summary>
    public static class PolicyScope
    {
        private static readonly HashSet<string> UserSettable = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "ShowLockNotification"     // the "Visa låsning" notice during learning: a preference, not protection
        };

        public static bool IsUserSettable(string valueName) => valueName != null && UserSettable.Contains(valueName);

        public static IEnumerable<string> UserSettableNames => UserSettable;
    }
}
