using System;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;
using PresenceLock.App.Settings;

namespace PresenceLock.App
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
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

                Application.Run(new TrayApplicationContext(PolicyReader.Load()));
                GC.KeepAlive(single);
            }
            return 0;
        }
    }
}
