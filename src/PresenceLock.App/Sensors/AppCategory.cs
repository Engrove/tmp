using System;
using System.Collections.Generic;

namespace PresenceLock.App.Sensors
{
    public enum ForegroundCategory { Neutral, Reading, Leaving }

    /// <summary>
    /// Maps a foreground process name to a coarse behavioural category. ONLY the exe
    /// name is ever inspected — never the window title, never document content. The
    /// lists are defaults; they can be overridden from policy so an org can add its own
    /// line-of-business apps without a rebuild.
    /// </summary>
    public sealed class AppCategory
    {
        // "Active read/review" apps: user plausibly sits still studying something.
        private readonly HashSet<string> _reading = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            // CAD / 3D / EDA
            "acad", "inventor", "revit", "solidworks", "sldworks", "catia", "creo",
            "freecad", "blender", "fusion360", "kicad", "eagle", "altium",
            // IDEs / editors (reading code)
            "devenv", "code", "rider", "clion", "pycharm", "idea", "studio64",
            "sublime_text", "notepad++",
            // document / review
            "acrord32", "acrobat", "foxitphantom", "foxitreader", "sumatrapdf",
            "winword", "powerpnt", "onenote",
            // live calls (present but still)
            "teams", "ms-teams", "zoom", "webex",
        };

        // Apps/states that often coincide with stepping away.
        private readonly HashSet<string> _leaving = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "explorer",     // desktop / shell focus
            "outlook",      // inbox triage before a break
            "lockapp",      // lock screen
        };

        public void AddReading(IEnumerable<string> names) { foreach (var n in names) _reading.Add(n); }
        public void AddLeaving(IEnumerable<string> names) { foreach (var n in names) _leaving.Add(n); }

        public ForegroundCategory Classify(string processName)
        {
            if (string.IsNullOrEmpty(processName)) return ForegroundCategory.Neutral;
            if (_reading.Contains(processName)) return ForegroundCategory.Reading;
            if (_leaving.Contains(processName)) return ForegroundCategory.Leaving;
            return ForegroundCategory.Neutral;
        }
    }
}
