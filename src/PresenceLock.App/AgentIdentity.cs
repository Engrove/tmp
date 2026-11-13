using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using PresenceLock.App.Interop;

namespace PresenceLock.App
{
    /// <summary>
    /// Which build is running, and which other PresenceLock agents run in this session (0.7.2).
    /// A field report showed a menu from an older version while 0.7.1 had been started: the log
    /// could not tell which version ran. Now the start line, --status and event 1019 say so.
    /// </summary>
    internal static class AgentIdentity
    {
        /// <summary>Version, e.g. "0.7.2".</summary>
        public static readonly string Version = typeof(AgentIdentity).Assembly.GetName().Version.ToString(3);

        /// <summary>Version with the commit it was built from, e.g. "0.7.2+a89ea33…" (falls back to Version).</summary>
        public static readonly string Full = ReadFull();

        private static string ReadFull()
        {
            try
            {
                var a = typeof(AgentIdentity).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
                return string.IsNullOrEmpty(a?.InformationalVersion) ? Version : a.InformationalVersion;
            }
            catch (Exception) { return Version; }
        }

        public static string ExePath()
        {
            try { using (var me = Process.GetCurrentProcess()) return me.MainModule.FileName; }
            catch (Exception) { return "?"; }
        }

        public sealed class AgentProcess
        {
            public int Pid;
            public string Path = "?";
            public string Version = "?";
            public override string ToString() => "pid " + Pid + ", version " + Version + ", " + Path;
        }

        /// <summary>
        /// PresenceLock processes in the AGENT role (not --status, --service, ...) in this session,
        /// other than the calling process. File version from the exe on disk.
        /// </summary>
        public static List<AgentProcess> OtherAgentsInSession()
        {
            var list = new List<AgentProcess>();
            try
            {
                using (var me = Process.GetCurrentProcess())
                    foreach (var p in Process.GetProcessesByName("PresenceLock"))
                        using (p)
                        {
                            if (p.Id == me.Id || p.SessionId != me.SessionId) continue;
                            if (!ProcessInfo.IsAgentRole(ProcessInfo.TryGetCommandLine(p.Id))) continue;
                            var a = new AgentProcess { Pid = p.Id };
                            try
                            {
                                a.Path = p.MainModule.FileName;
                                var fv = FileVersionInfo.GetVersionInfo(a.Path);
                                a.Version = string.IsNullOrEmpty(fv.ProductVersion) ? fv.FileVersion : fv.ProductVersion;
                            }
                            catch (Exception) { }
                            list.Add(a);
                        }
            }
            catch (Exception) { }
            return list;
        }
    }
}
