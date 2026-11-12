using System;
using System.Runtime.InteropServices;
using System.Text;

namespace PresenceLock.App.Interop
{
    /// <summary>
    /// All P/Invoke surface in one place. Every signature here is standard, documented
    /// Win32; nothing requires elevation. The app runs as the interactive user.
    /// </summary>
    internal static class NativeMethods
    {
        // --- idle time -----------------------------------------------------------
        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("kernel32.dll")]
        public static extern uint GetTickCount();

        /// <summary>Seconds since the last user input across the whole session.</summary>
        public static double IdleSeconds()
        {
            var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
            if (!GetLastInputInfo(ref lii)) return 0.0;
            uint now = GetTickCount();
            // Unsigned wrap-safe subtraction.
            uint deltaMs = unchecked(now - lii.dwTime);
            return deltaMs / 1000.0;
        }

        // --- locking -------------------------------------------------------------
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool LockWorkStation();

        // --- foreground window / process ----------------------------------------
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        // --- Raw Input (WM_INPUT) ------------------------------------------------
        public const int WM_INPUT = 0x00FF;

        [StructLayout(LayoutKind.Sequential)]
        public struct RAWINPUTDEVICE
        {
            public ushort usUsagePage;
            public ushort usUsage;
            public uint dwFlags;
            public IntPtr hwndTarget;
        }

        public const ushort HID_USAGE_PAGE_GENERIC = 0x01;
        public const ushort HID_USAGE_GENERIC_MOUSE = 0x02;   // the ONLY device registered
        public const uint RIDEV_INPUTSINK = 0x00000100; // receive input even when not foreground

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RegisterRawInputDevices(
            [MarshalAs(UnmanagedType.LPArray)] RAWINPUTDEVICE[] pRawInputDevices,
            uint uiNumDevices, uint cbSize);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand,
            IntPtr pData, ref uint pcbSize, uint cbSizeHeader);

        public const uint RID_INPUT = 0x10000003;
        public const uint RIM_TYPEMOUSE = 0;

        [StructLayout(LayoutKind.Sequential)]
        public struct RAWINPUTHEADER
        {
            public uint dwType;
            public uint dwSize;
            public IntPtr hDevice;
            public IntPtr wParam;
        }

        /// <summary>
        /// Win32 RAWMOUSE. NOTE the explicit layout: usButtonFlags/usButtonData live in a
        /// union with ULONG ulButtons, so the union is 4-byte aligned and starts at offset
        /// 4, not 2. A naive Sequential layout reads the wheel delta from the wrong bytes.
        /// Total size 24 bytes.
        /// </summary>
        [StructLayout(LayoutKind.Explicit, Size = 24)]
        public struct RAWMOUSE
        {
            [FieldOffset(0)]  public ushort usFlags;
            [FieldOffset(4)]  public uint ulButtons;
            [FieldOffset(4)]  public ushort usButtonFlags;
            [FieldOffset(6)]  public ushort usButtonData;   // wheel delta when RI_MOUSE_WHEEL set
            [FieldOffset(8)]  public uint ulRawButtons;
            [FieldOffset(12)] public int lLastX;            // relative, unless MOUSE_MOVE_ABSOLUTE
            [FieldOffset(16)] public int lLastY;
            [FieldOffset(20)] public uint ulExtraInformation;
        }

        public const ushort RI_MOUSE_WHEEL = 0x0400;
        public const ushort RI_MOUSE_HWHEEL = 0x0800;
        public const ushort MOUSE_MOVE_ABSOLUTE = 0x0001;   // RDP / VMs / tablets report 0..65535

        // --- passive OS state ------------------------------------------------------
        // Documented: "SystemExecutionState (16) ... receives a ULONG ... any combination of
        // ES_SYSTEM_REQUIRED, ES_DISPLAY_REQUIRED, or ES_USER_PRESENT". The docs do NOT state
        // whether other processes' PowerSetRequest() calls are aggregated; verify on target
        // hardware with:  PresenceLock.exe --probe-signals
        public const int SystemExecutionState = 16;
        public const uint ES_DISPLAY_REQUIRED = 0x00000002;

        [DllImport("powrprof.dll")]
        public static extern uint CallNtPowerInformation(int informationLevel, IntPtr inputBuffer,
            uint inputBufferLength, out uint outputBuffer, uint outputBufferLength);

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder exeName, ref uint size);

        /// <summary>Windows 8+. Returns 0 (ERROR_SUCCESS), 15700 (APPMODEL_ERROR_NO_PACKAGE) or 122.</summary>
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder packageFamilyName);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct OSVERSIONINFOEXW
        {
            public uint dwOSVersionInfoSize;
            public uint dwMajorVersion;
            public uint dwMinorVersion;
            public uint dwBuildNumber;
            public uint dwPlatformId;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szCSDVersion;
            public ushort wServicePackMajor;
            public ushort wServicePackMinor;
            public ushort wSuiteMask;
            public byte wProductType;
            public byte wReserved;
        }

        public const byte VER_NT_WORKSTATION = 1;

        /// <summary>Returns the real OS version regardless of manifest compatibility shims.</summary>
        [DllImport("ntdll.dll")]
        public static extern int RtlGetVersion(ref OSVERSIONINFOEXW versionInfo);

        // --- WTS session notifications ------------------------------------------
        public const int WM_WTSSESSION_CHANGE = 0x02B1;
        public const int WTS_SESSION_LOCK = 0x7;
        public const int WTS_SESSION_UNLOCK = 0x8;
        public const int NOTIFY_FOR_THIS_SESSION = 0;

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool WTSRegisterSessionNotification(IntPtr hWnd, int dwFlags);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);
    }
}
