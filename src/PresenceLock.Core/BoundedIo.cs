using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace PresenceLock.Core
{
    /// <summary>
    /// Hard size limits for everything the agent and the guard READ. A file larger than its limit
    /// is treated as corrupt (the caller starts over or keeps its protected copy) and is never
    /// loaded into memory: a multi-GB profile.json must not be able to crash the agent in a loop
    /// (NIS2 mode would lock the session every time) or the SYSTEM guard that syncs it.
    /// </summary>
    public static class BoundedFile
    {
        /// <summary>profile.json is ~4-8 KB (fixed-size structures only); 128x margin.</summary>
        public const long MaxProfileBytes = 1L << 20;
        /// <summary>habits.json at its own caps (5000 episodes, 256 scores) is ~0.4 MB; 5x margin.</summary>
        public const long MaxJournalBytes = 2L << 20;

        public static string ReadAllText(string path, long maxBytes)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                if (fs.Length > maxBytes)
                    throw new InvalidDataException("file larger than " + maxBytes + " bytes: " + fs.Length);
                var buf = new byte[(int)fs.Length];
                int read = 0;
                while (read < buf.Length)
                {
                    int n = fs.Read(buf, read, buf.Length - read);
                    if (n <= 0) break;
                    read += n;
                }
                if (fs.ReadByte() >= 0) throw new InvalidDataException("file grew while being read");
                return new UTF8Encoding(false).GetString(buf, 0, read).TrimStart('﻿');
            }
        }
    }

    /// <summary>
    /// Per-key rate limit for log lines and event-log entries. The first occurrence is always
    /// emitted; repeats of the same key within the window are counted, not written; the next
    /// emitted entry for that key reports how many were suppressed. The key table itself is
    /// bounded (oldest key evicted), so a stream of distinct keys cannot grow memory either.
    /// </summary>
    public sealed class EventThrottle
    {
        private sealed class Entry { public long LastEmitTicks; public int Suppressed; }
        private readonly Dictionary<string, Entry> _keys = new Dictionary<string, Entry>(StringComparer.Ordinal);
        private readonly object _gate = new object();
        public const int MaxKeys = 256;

        public int KeyCount { get { lock (_gate) return _keys.Count; } }

        public bool ShouldEmit(string key, long nowUtcTicks, TimeSpan window, out int suppressed)
        {
            lock (_gate)
            {
                suppressed = 0;
                if (_keys.TryGetValue(key, out var e))
                {
                    if (nowUtcTicks - e.LastEmitTicks < window.Ticks) { e.Suppressed++; return false; }
                    suppressed = e.Suppressed;
                    e.Suppressed = 0;
                    e.LastEmitTicks = nowUtcTicks;
                    return true;
                }
                if (_keys.Count >= MaxKeys)
                {
                    string oldest = null; long t = long.MaxValue;
                    foreach (var kv in _keys) if (kv.Value.LastEmitTicks < t) { t = kv.Value.LastEmitTicks; oldest = kv.Key; }
                    if (oldest != null) _keys.Remove(oldest);
                }
                _keys[key] = new Entry { LastEmitTicks = nowUtcTicks };
                return true;
            }
        }

        public static string WithSuppressed(string message, int suppressed, TimeSpan window) => suppressed <= 0 ? message
            : message + " [" + suppressed + " identical event(s) suppressed in the previous " + (int)window.TotalMinutes + " min]";
    }

    /// <summary>
    /// The agent's diagnostic text log with a hard disk budget: at most two files of MaxBytes
    /// (current + one rotated), each line at most MaxLineChars, and an identical message is
    /// written at most once per RepeatWindow (with a count of the repeats).
    /// Worst case on disk: 2 x MaxBytes + one line.
    /// </summary>
    public sealed class RotatingLog
    {
        public const long DefaultMaxBytes = 256 * 1024;
        public const int MaxLineChars = 2048;
        public static readonly TimeSpan RepeatWindow = TimeSpan.FromMinutes(10);

        private readonly string _path;
        private readonly long _maxBytes;
        private readonly EventThrottle _throttle = new EventThrottle();
        private readonly object _gate = new object();

        public RotatingLog(string path, long maxBytes = DefaultMaxBytes) { _path = path; _maxBytes = maxBytes; }
        public string PathName => _path;
        public string RotatedPathName => _path + ".1";

        /// <summary>
        /// Retire every line older than <paramref name="localCutoff"/> (lines start with their local
        /// timestamp). The rotated file is deleted when nothing in it is recent enough. Files are at
        /// most MaxBytes, so this is a bounded rewrite. Returns the number of lines retired.
        /// </summary>
        public int Retire(DateTime localCutoff)
        {
            int retired = 0;
            lock (_gate)
            {
                foreach (var f in new[] { RotatedPathName, _path })
                {
                    if (!File.Exists(f)) continue;
                    if (new FileInfo(f).Length > 4 * _maxBytes) { File.Delete(f); retired++; continue; }   // not ours: never parse
                    var lines = File.ReadAllLines(f, new UTF8Encoding(false));
                    var keep = new List<string>(lines.Length);
                    foreach (var l in lines)
                    {
                        if (l.Length >= 19 && DateTime.TryParseExact(l.Substring(0, 19), "yyyy-MM-dd HH:mm:ss",
                                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var t)
                            && t < localCutoff) { retired++; continue; }
                        keep.Add(l);
                    }
                    if (keep.Count == lines.Length) continue;
                    if (keep.Count == 0) { File.Delete(f); continue; }
                    string tmp = f + ".tmp";
                    File.WriteAllLines(tmp, keep, new UTF8Encoding(false));
                    File.Replace(tmp, f, null);
                }
            }
            return retired;
        }

        /// <summary>Returns false if the line was suppressed as a repeat.</summary>
        public bool Write(string message, DateTime localNow, long nowUtcTicks)
        {
            message = message ?? "";
            if (message.Length > MaxLineChars) message = message.Substring(0, MaxLineChars) + " ...[truncated]";
            message = message.Replace("\r", " ").Replace("\n", " | ");
            if (!_throttle.ShouldEmit(message, nowUtcTicks, RepeatWindow, out int suppressed)) return false;
            if (suppressed > 0) message += " (repeated " + suppressed + " more time(s) in the previous " + (int)RepeatWindow.TotalMinutes + " min)";
            string line = localNow.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture)
                          + "  " + message + Environment.NewLine;
            lock (_gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path));
                var fi = new FileInfo(_path);
                if (fi.Exists && fi.Length + Encoding.UTF8.GetByteCount(line) > _maxBytes)
                {
                    if (File.Exists(RotatedPathName)) File.Delete(RotatedPathName);
                    File.Move(_path, RotatedPathName);
                }
                File.AppendAllText(_path, line, new UTF8Encoding(false));
            }
            return true;
        }
    }
}
