using System;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;

namespace PresenceLock.Core
{
    /// <summary>
    /// The habit journal file: %LOCALAPPDATA%\PresenceLock\habits.json — deliberately SEPARATE from
    /// profile.json, because it is a 42-day presence timeline (when the user paused and for how
    /// long). It is never exported, never collected to the admin share and never copied to the
    /// guard's protected store. Deleting or editing it cannot weaken locking below policy: habits
    /// can only bring a confirmation dim forward, never postpone anything.
    /// </summary>
    public static class HabitStore
    {
        private static readonly DataContractJsonSerializer Serializer =
            new DataContractJsonSerializer(typeof(HabitJournal));

        public static string DefaultPath() => Path.Combine(ProfileStore.DefaultDirectory(), "habits.json");

        public static string Serialize(HabitJournal j)
        {
            using (var ms = new MemoryStream())
            {
                Serializer.WriteObject(ms, j);
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        public static HabitJournal Deserialize(string json)
        {
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                var j = (HabitJournal)Serializer.ReadObject(ms);
                j.Normalize();
                return j;
            }
        }

        /// <summary>Load this user's journal, or start an empty one (corrupt / foreign / newer = start over).</summary>
        public static HabitJournal LoadOrCreate(string path, string userSid) => LoadWithRecovery(path, userSid, out _);

        /// <summary>
        /// Like <see cref="LoadOrCreate"/>, but reports when an existing journal could not be used.
        /// Losing the journal only removes habit acceleration (relearned in 2-6 weeks); locking is
        /// unaffected. The caps are re-applied on load.
        /// </summary>
        public static HabitJournal LoadWithRecovery(string path, string userSid, out string recovery)
        {
            recovery = null;
            try
            {
                if (File.Exists(path))
                {
                    var j = Deserialize(BoundedFile.ReadAllText(path, BoundedFile.MaxJournalBytes));   // oversized = corrupt
                    if (j.SchemaVersion == HabitJournal.CurrentSchemaVersion &&
                        string.Equals(j.UserSid, userSid, StringComparison.OrdinalIgnoreCase))
                        return j;
                    recovery = "habits.json belongs to another user or version; started a new journal";
                }
            }
            catch (InvalidDataException ex) { recovery = "habits.json oversized (" + ex.Message + "); started a new journal"; }
            catch (Exception ex) { recovery = "habits.json unreadable (" + ex.GetType().Name + "); started a new journal"; }
            return new HabitJournal { UserSid = userSid ?? "" };
        }

        public static void Save(string path, HabitJournal j)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, Serialize(j), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }
    }
}
