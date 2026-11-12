using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using PresenceLock.Core;

namespace PresenceLock.App
{
    /// <summary>
    /// Administrative command line (run as the user whose profile you want, e.g. from a
    /// logon script or remote shell). Output goes to the calling console.
    ///
    ///   PresenceLock.exe --status
    ///   PresenceLock.exe --export &lt;file.json&gt;
    ///   PresenceLock.exe --export-baseline &lt;file.json&gt;
    ///   PresenceLock.exe --merge-baseline &lt;out.json&gt; &lt;in1.json&gt; &lt;in2.json&gt; ...
    ///   PresenceLock.exe --reset-profile
    ///
    /// The running agent saves every 5 minutes and on lock/logoff, so the on-disk profile
    /// read here can be up to 5 minutes behind the agent's memory.
    /// </summary>
    internal static class Cli
    {
        [DllImport("kernel32.dll")]
        private static extern bool AttachConsole(int dwProcessId);
        private const int ATTACH_PARENT_PROCESS = -1;

        public static int Run(string[] args)
        {
            AttachConsole(ATTACH_PARENT_PROCESS); // WinExe: borrow the caller's console if any
            Console.WriteLine();
            try
            {
                string path = ProfileStore.DefaultPath();
                switch (args[0].ToLowerInvariant())
                {
                    case "--status":
                    {
                        var p = Load(path);
                        Console.WriteLine("profile: " + path);
                        Console.WriteLine(p.Modes.Explain(DateTime.UtcNow.Ticks));
                        if (p.Modes.PromotedUtcTicks != 0)
                            Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                                "promoted {0:u} (window {1:P1}, upper95 {2:P1}{3})",
                                new DateTime(p.Modes.PromotedUtcTicks, DateTimeKind.Utc),
                                p.Modes.PromotionWindowRate, p.Modes.PromotionUpperBound,
                                p.Modes.PromotionForcedByPolicy ? ", forced by policy" : ""));
                        var reading = new double[FeatureSchema.Count]; reading[FeatureSchema.CtxReading] = 1;
                        var neutral = new double[FeatureSchema.Count];
                        Console.WriteLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                            "lock time t(90%): neutral {0:F0} s, reading-app context {1:F0} s",
                            p.Model.LockTime(neutral, p.Config.LockThreshold),
                            p.Model.LockTime(reading, p.Config.LockThreshold)));
                        return 0;
                    }
                    case "--export":
                        Need(args, 2);
                        File.WriteAllText(args[1], ProfileStore.Serialize(Load(path)));
                        Console.WriteLine("exported " + args[1]);
                        return 0;
                    case "--export-baseline":
                        Need(args, 2);
                        File.WriteAllText(args[1], ProfileStore.Serialize(ProfileStore.ExportBaseline(Load(path))));
                        Console.WriteLine("exported anonymised baseline " + args[1]);
                        return 0;
                    case "--merge-baseline":
                    {
                        Need(args, 3);
                        var inputs = new List<UserProfile>();
                        for (int i = 2; i < args.Length; i++)
                            inputs.Add(ProfileStore.Deserialize(File.ReadAllText(args[i])));
                        File.WriteAllText(args[1], ProfileStore.Serialize(ProfileStore.MergeBaseline(inputs)));
                        Console.WriteLine("merged " + inputs.Count + " profiles into " + args[1]);
                        return 0;
                    }
                    case "--reset-profile":
                        if (File.Exists(path)) File.Delete(path);
                        Console.WriteLine("profile removed; it is recreated (learning mode) at next agent start");
                        return 0;
                    default:
                        Console.WriteLine("usage: PresenceLock.exe [--status | --export f | --export-baseline f | " +
                                          "--merge-baseline out in1 in2 ... | --reset-profile]");
                        return 2;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("error: " + ex.Message);
                return 1;
            }
        }

        private static UserProfile Load(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("no profile for this user yet", path);
            return ProfileStore.Deserialize(File.ReadAllText(path));
        }

        private static void Need(string[] args, int n)
        {
            if (args.Length < n) throw new ArgumentException("missing argument(s) for " + args[0]);
        }
    }
}
