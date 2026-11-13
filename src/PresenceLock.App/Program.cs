using System;
using System.Security.Principal;
using System.ServiceProcess;
using System.Threading;
using System.Windows.Forms;
using PresenceLock.App.Guard;
using PresenceLock.App.Interop;
using PresenceLock.App.Settings;

namespace PresenceLock.App
{
    internal static class Program
    {
        private static bool AnotherAgentRunsInThisSession()
        {
            try
            {
                using (var me = System.Diagnostics.Process.GetCurrentProcess())
                {
                    string myPath = me.MainModule.FileName;
                    foreach (var p in System.Diagnostics.Process.GetProcessesByName("PresenceLock"))
                    {
                        using (p)
                        {
                            if (p.Id == me.Id || p.SessionId != me.SessionId) continue;
                            string path = null;
                            try { path = p.MainModule.FileName; } catch (Exception) { }
                            if (string.Equals(path, myPath, StringComparison.OrdinalIgnoreCase)
                                && ProcessInfo.IsAgentRole(ProcessInfo.TryGetCommandLine(p.Id)))
                                return true;
                        }
                    }
                }
            }
            catch (Exception) { return true; }   // cannot tell: keep the single-instance behaviour
            return false;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            // Started by the Service Control Manager as "PresenceLock Guard" (LocalSystem).
            if (args.Length > 0 && args[0].Equals("--service", StringComparison.OrdinalIgnoreCase))
            {
                ServiceBase.Run(new GuardService());
                return 0;
            }
            if (args.Length > 0) return Cli.Run(args);

            // One agent per user session. "Local\" scopes the mutex to the session, the SID
            // makes it explicit per user (fast user switching / RDS hosts).
            string sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
            bool created;
            using (var single = new Mutex(true, @"Local\PresenceLock-" + sid, out created))
            {
                // The mutex name is predictable, so another process of the user can create it first.
                // Only step aside if a REAL agent (installed exe, agent role) already runs in this
                // session; otherwise the mutex is squatted and this agent must run anyway (review F04).
                if (!created && AnotherAgentRunsInThisSession())
                {
                    AgentLog.Write("start " + AgentIdentity.Full + " ended: the same agent already runs in this session (" +
                                   string.Join("; ", AgentIdentity.OtherAgentsInSession()) + ")");
                    return 0;
                }
                if (!created) AgentLog.Write("agent mutex held by a process that is not this agent; running anyway");

                // A different PresenceLock (other path, e.g. an older version started from another
                // folder) may run next to this one: two icons, two menus. Say so (0.7.2).
                var others = AgentIdentity.OtherAgentsInSession();
                if (others.Count > 0)
                    AgentEvents.Write(AgentEvents.AnotherAgentRunning, System.Diagnostics.EventLogEntryType.Warning,
                        "PresenceLock " + AgentIdentity.Full + " (" + AgentIdentity.ExePath() + ") started while another PresenceLock agent runs in this session: " +
                        string.Join("; ", others) + ". Two agents mean two tray icons; end the older one.", throttle: false);

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (s, e) => AgentLog.Write("ui exception: " + e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, e) => AgentLog.Write("fatal: " + e.ExceptionObject);

                var settings = PolicyReader.Load();

                if (!settings.AllowUserExit)
                {
                    // NIS2 mode, line 1: a standard user can no longer terminate this process.
                    string error = ProcessHardening.Apply(sid);
                    AgentLog.Write(error == null ? "process hardened against termination"
                                                 : "process hardening FAILED (guard service remains): " + error);
                }

                while (true)
                {
                    using (var ctx = new TrayApplicationContext(settings))
                        Application.Run(ctx);

                    // Exit allowed by policy: any end of the loop is a real exit.
                    if (settings.AllowUserExit) break;

                    // NIS2 mode, line 2: the loop can also end because another process posted
                    // WM_QUIT/WM_CLOSE to our thread. That is not an exit: start again.
                    // (Logoff/shutdown terminate the process from outside and never get here.)
                    AgentLog.Write("message loop ended without permission; restarting");
                    Thread.Sleep(500);
                }
                GC.KeepAlive(single);
            }
            return 0;
        }
    }
}
