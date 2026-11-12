using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using static PresenceLock.App.Interop.NativeMethods;

namespace PresenceLock.App.Interop
{
    /// <summary>One raw MOUSE event, already decoded. The keyboard is deliberately not
    /// registered for raw input at all (see MessageWindow).</summary>
    public struct RawInputSample
    {
        public int Dx;
        public int Dy;
        public int WheelDelta;   // 0 unless a wheel event
        public long TimestampTicks;
    }

    /// <summary>
    /// A hidden message-only window that is the single place OS messages arrive:
    ///   * WM_INPUT     -> decoded MOUSE kinematics (RawInput)
    ///   * WM_WTSSESSION_CHANGE -> session lock / unlock
    /// It owns no policy; it just surfaces events for the orchestrator.
    ///
    /// The keyboard is intentionally NOT registered. Keyboard activity is already visible as
    /// "not idle" through GetLastInputInfo, and a background process sinking raw keyboard
    /// input is the textbook keylogger pattern that EDR products and privacy reviews flag.
    /// The agent therefore has no code path that can observe keystrokes at all.
    /// </summary>
    public sealed class MessageWindow : NativeWindow, IDisposable
    {
        public event Action<RawInputSample> RawInput;
        public event Action SessionLocked;
        public event Action SessionUnlocked;
        /// <summary>RDP client closed / network drop / console handed to RDP (and the reverse).</summary>
        public event Action SessionDisconnected;
        public event Action SessionConnected;

        private int _lastAbsX, _lastAbsY;
        private bool _hasAbs;

        public MessageWindow()
        {
            var cp = new CreateParams
            {
                Caption = "PresenceLockMsgWnd",
                // HWND_MESSAGE = -3: message-only window, never visible, no taskbar entry.
                Parent = new IntPtr(-3)
            };
            CreateHandle(cp);

            var devices = new[]
            {
                new RAWINPUTDEVICE
                {
                    usUsagePage = HID_USAGE_PAGE_GENERIC,
                    usUsage = HID_USAGE_GENERIC_MOUSE,
                    dwFlags = RIDEV_INPUTSINK,
                    hwndTarget = Handle
                }
            };
            RegisterRawInputDevices(devices, (uint)devices.Length,
                (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));

            WTSRegisterSessionNotification(Handle, NOTIFY_FOR_THIS_SESSION);
        }

        protected override void WndProc(ref Message m)
        {
            switch (m.Msg)
            {
                case WM_INPUT:
                    HandleRawInput(m.LParam);
                    break;
                case WM_WTSSESSION_CHANGE:
                    int ev = m.WParam.ToInt32();
                    if (ev == WTS_SESSION_LOCK) SessionLocked?.Invoke();
                    else if (ev == WTS_SESSION_UNLOCK) SessionUnlocked?.Invoke();
                    else if (ev == WTS_CONSOLE_DISCONNECT || ev == WTS_REMOTE_DISCONNECT) SessionDisconnected?.Invoke();
                    else if (ev == WTS_CONSOLE_CONNECT || ev == WTS_REMOTE_CONNECT) SessionConnected?.Invoke();
                    break;
            }
            base.WndProc(ref m);
        }

        // Reused buffer: WM_INPUT can arrive at 1000 Hz from a gaming mouse; allocating per
        // message would be pointless churn. Mouse RAWINPUT is 48 bytes on x64.
        private IntPtr _buffer = IntPtr.Zero;
        private uint _bufferSize;

        private void HandleRawInput(IntPtr hRawInput)
        {
            uint size = 0;
            GetRawInputData(hRawInput, RID_INPUT, IntPtr.Zero, ref size,
                (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER)));
            if (size == 0) return;

            if (size > _bufferSize)
            {
                if (_buffer != IntPtr.Zero) Marshal.FreeHGlobal(_buffer);
                _bufferSize = Math.Max(size, 128u);
                _buffer = Marshal.AllocHGlobal((int)_bufferSize);
            }
            IntPtr buffer = _buffer;
            {
                uint read = GetRawInputData(hRawInput, RID_INPUT, buffer, ref size,
                    (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER)));
                if (read != size) return;

                var header = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
                int headerSize = Marshal.SizeOf(typeof(RAWINPUTHEADER));

                var sample = new RawInputSample { TimestampTicks = DateTime.UtcNow.Ticks };

                if (header.dwType == RIM_TYPEMOUSE)
                {
                    var mouse = Marshal.PtrToStructure<RAWMOUSE>(buffer + headerSize);

                    if ((mouse.usFlags & MOUSE_MOVE_ABSOLUTE) != 0)
                    {
                        // RDP, VMs and pen/tablet devices report absolute 0..65535. Convert to
                        // a pixel-scale delta so the speed heuristics mean the same thing.
                        var vs = SystemInformation.VirtualScreen;
                        if (_hasAbs)
                        {
                            sample.Dx = (int)((long)(mouse.lLastX - _lastAbsX) * vs.Width / 65535);
                            sample.Dy = (int)((long)(mouse.lLastY - _lastAbsY) * vs.Height / 65535);
                        }
                        _lastAbsX = mouse.lLastX; _lastAbsY = mouse.lLastY; _hasAbs = true;
                    }
                    else
                    {
                        sample.Dx = mouse.lLastX;
                        sample.Dy = mouse.lLastY;
                    }

                    if ((mouse.usButtonFlags & (RI_MOUSE_WHEEL | RI_MOUSE_HWHEEL)) != 0)
                        sample.WheelDelta = unchecked((short)mouse.usButtonData);
                }
                else return;

                RawInput?.Invoke(sample);
            }
        }

        public void Dispose()
        {
            try { WTSUnRegisterSessionNotification(Handle); } catch { }
            if (Handle != IntPtr.Zero) DestroyHandle();
            if (_buffer != IntPtr.Zero) { Marshal.FreeHGlobal(_buffer); _buffer = IntPtr.Zero; }
        }
    }
}
