using System;
using System.Globalization;
using System.IO;
using System.Text;
using PresenceLock.Core;

namespace PresenceLock.App
{
    /// <summary>
    /// Tiny local diagnostic log for administrators: %LOCALAPPDATA%\PresenceLock\agent.log.
    /// Records lifecycle events, mode changes and errors only — never input, process names,
    /// window titles or anything else about what the user is doing. Rotates at 256 KB.
    /// </summary>
    internal static class AgentLog
    {
        private const long MaxBytes = 256 * 1024;
        private static readonly object Gate = new object();

        public static string PathName => Path.Combine(ProfileStore.DefaultDirectory(), "agent.log");

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(ProfileStore.DefaultDirectory());
                    var fi = new FileInfo(PathName);
                    if (fi.Exists && fi.Length > MaxBytes)
                    {
                        string old = PathName + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(PathName, old);
                    }
                    File.AppendAllText(PathName,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)
                        + "  " + message + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
                // logging must never take the agent down
            }
        }
    }
}
