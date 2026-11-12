using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using PresenceLock.Core;

namespace PresenceLock.App.Guard
{
    /// <summary>
    /// The guard's protected profile copies: %ProgramFiles%\PresenceLock\state\&lt;SID&gt;.json.
    /// NOT under %ProgramData%: ordinary users may create folders there, so a user could
    /// pre-create (and own) the folder before the guard does and plant their own "protected"
    /// copies. Only administrators/SYSTEM can create anything under %ProgramFiles%.
    ///   directory  SYSTEM + Administrators full control, owner Administrators, no inheritance.
    ///   each file  SYSTEM + Administrators full control, the profile's own user READ only.
    /// The agent (user context) can read its own copy but never write it.
    /// </summary>
    internal static class ProtectedStore
    {
        public static string Directory_ => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PresenceLock", "state");

        public static string PathFor(string sid) => Path.Combine(Directory_, Sanitize(sid) + ".json");

        private static string Sanitize(string sid)
        {
            foreach (char c in sid)
                if (!(char.IsDigit(c) || c == '-' || c == 'S')) throw new ArgumentException("invalid SID");
            return sid;
        }

        private static readonly SecurityIdentifier SystemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        private static readonly SecurityIdentifier AdminsSid = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);

        /// <summary>Agent side: the protected copy for this user, or null (missing/unreadable/invalid).</summary>
        public static UserProfile TryRead(string sid)
        {
            try
            {
                string p = PathFor(sid);
                if (!File.Exists(p)) return null;
                return ProfileStore.Deserialize(File.ReadAllText(p, Encoding.UTF8));
            }
            catch (Exception) { return null; }
        }

        /// <summary>Guard side (SYSTEM): create/repair the directory with its protected ACL.</summary>
        public static void EnsureDirectory()
        {
            var ds = new DirectorySecurity();
            ds.SetOwner(AdminsSid);
            ds.SetAccessRuleProtection(true, false);
            foreach (var sid in new[] { SystemSid, AdminsSid })
                ds.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
            if (!Directory.Exists(Directory_)) Directory.CreateDirectory(Directory_, ds);
            else Directory.SetAccessControl(Directory_, ds);
        }

        /// <summary>Guard side (SYSTEM): atomically write a protected copy readable only by its user.</summary>
        public static void Write(string sid, UserProfile profile)
        {
            string path = PathFor(sid);
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, ProfileStore.Serialize(profile), new UTF8Encoding(false));

            var fs = new FileSecurity();
            fs.SetOwner(AdminsSid);
            fs.SetAccessRuleProtection(true, false);
            fs.AddAccessRule(new FileSystemAccessRule(SystemSid, FileSystemRights.FullControl, AccessControlType.Allow));
            fs.AddAccessRule(new FileSystemAccessRule(AdminsSid, FileSystemRights.FullControl, AccessControlType.Allow));
            fs.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.Read, AccessControlType.Allow));
            File.SetAccessControl(tmp, fs);

            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        /// <summary>Administrator: remove the protected copy (used by an elevated --reset-profile).</summary>
        public static void Delete(string sid)
        {
            string p = PathFor(sid);
            if (File.Exists(p)) File.Delete(p);
        }
    }
}
