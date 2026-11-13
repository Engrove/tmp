using System;
using System.Collections.Generic;
using System.Threading;

namespace PresenceLock.App
{
    /// <summary>
    /// All file and network I/O of the agent runs here, never on the UI thread that drives the
    /// security loop (WinForms timer): a hung file server or a full disk can delay a save or an
    /// export, not a lock. One worker thread, one pending job per key (latest wins), so a slow
    /// share cannot build up a queue. The caller captures what to write (serialised text) on the UI
    /// thread; the job only does I/O.
    /// </summary>
    internal sealed class BackgroundWriter : IDisposable
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, Action> _pending = new Dictionary<string, Action>(StringComparer.Ordinal);
        private readonly Queue<string> _order = new Queue<string>();
        private readonly Thread _thread;
        private bool _stopping;

        public string Busy { get; private set; }          // key of the job running now (diagnostics)
        public DateTime BusySinceUtc { get; private set; }

        public BackgroundWriter()
        {
            _thread = new Thread(Run) { IsBackground = true, Name = "PresenceLock I/O" };
            _thread.Start();
        }

        /// <summary>Queue <paramref name="job"/> under <paramref name="key"/>; replaces a not-yet-started job with the same key.</summary>
        public void Post(string key, Action job)
        {
            lock (_gate)
            {
                if (_stopping) return;
                if (!_pending.ContainsKey(key)) _order.Enqueue(key);
                _pending[key] = job;
                Monitor.Pulse(_gate);
            }
        }

        private void Run()
        {
            while (true)
            {
                string key; Action job;
                lock (_gate)
                {
                    while (_order.Count == 0 && !_stopping) Monitor.Wait(_gate);
                    if (_order.Count == 0) return;
                    key = _order.Dequeue();
                    job = _pending[key];
                    _pending.Remove(key);
                    Busy = key;
                    BusySinceUtc = DateTime.UtcNow;
                }
                try { job(); }
                catch (Exception ex) { AgentLog.Write("background " + key + " failed: " + ex.GetType().Name); }
                finally { Busy = null; }
            }
        }

        /// <summary>Finish what is queued (bounded wait), then stop. Used at shutdown/logoff.</summary>
        public void Flush(TimeSpan max)
        {
            lock (_gate) { _stopping = true; Monitor.Pulse(_gate); }
            _thread.Join(max);
        }

        public void Dispose() => Flush(TimeSpan.FromSeconds(5));
    }
}
