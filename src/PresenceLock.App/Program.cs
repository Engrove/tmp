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
                if (!created) return 0;

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
