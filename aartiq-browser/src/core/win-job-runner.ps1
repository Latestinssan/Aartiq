# ============================================================================
# win-job-runner.ps1 - Aartiq Windows OS-level sandbox runner.
#
# SECURITY INVARIANTS
# -------------------
# 1. The target process is created SUSPENDED and assigned to a Job Object
#    created by this helper BEFORE its first instruction runs. It can never
#    execute a single instruction outside the Job Object.
# 2. Job Object handles remain open (held by this process) for the entire
#    target-process lifetime. JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE guarantees
#    the whole process tree is terminated if this helper exits.
# 3. When `sandbox.useAppContainer` is true (the default), the target runs
#    under an APP CONTAINER (a Windows 8+ OS-enforced isolation principal):
#      - The target is created with the SECURITY_CAPABILITIES proc-thread
#        attribute via CreateProcessW (the Microsoft LaunchAppContainer
#        pattern). CreateProcessAsUserW does NOT support this attribute, so
#        the AppContainer target is launched with the helper's own token and
#        the kernel builds the container token at process start.
#      - The container ships with ZERO capabilities, so it CANNOT initiate
#        network traffic (no internetClient / anyNetwork). Read/write is
#        permitted ONLY to paths whose ACL explicitly grants the package SID -
#        the allowlisted directories, the sandbox workspace, and the
#        AppContainer profile folder (LOCALAPPDATA/TEMP rerouted by the OS).
#      - Directory allowlist is OS-ENFORCED: before the target is launched,
#        this helper grants the derived package SID read(+execute) access to
#        every allowlisted read directory and read+write+execute (modify) to
#        every allowlisted write directory and the workspace, via icacls.
#        Anything the allowlist does not enumerate stays DENIED by default.
#      - Grants and the profile are best-effort removed after the run so no
#        persistent ACL residue or orphan profile survives on the user's
#        machine.
# 3b. The LOW-INTEGRITY RESTRICTED TOKEN path is the `useAppContainer:false`
#     fallback: dangerous privileges (SeDebug, SeImpersonate, SeLoadDriver,
#     SeRestore, ...) are DELETED from a duplicate of the helper's token and
#     the Low mandatory integrity label (S-1-16-4096) is applied via
#     SetTokenInformation(TokenIntegrityLevel). The target then runs via
#     CreateProcessAsUserW. An AppContainer process relies on the kernel-built
#     container token restrictions instead of a crafted Low-IL token.
# 4. Every setup step failure returns a structured error and exits non-zero;
#    the target is never allowed to run uncontained. If `useAppContainer`
#    cannot be satisfied (old OS, API failure, grant failure on a writable
#    path), the runner FAILS CLOSED - it never silently degrades to a
#    less-isolated profile.
# 5. The verification loop runs after setup: Job Object membership is
#    re-checked before the target resumes.
#
# Reference: this mirrors Microsoft's LaunchAppContainer sample
# (microsoft/SandboxSecurityTools) and the "Launch an AppContainer" and
# "Processes in the Client Security Context" documentation.
#
# Usage: powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
#          -File win-job-runner.ps1 <payload.json>
#
# Payload schema:
# {
#   "command": "<resolved executable absolute path or name>",
#   "args": ["..."],
#   "env": { "KEY": "value" },        // sanitized environment (allowlist only)
#   "cwd": "<absolute working directory that exists>",
#   "maxProcesses": 64,               // active process limit (>0)
#   "maxMemoryBytes": 0,              // 0 = no job memory limit
#   "timeoutMs": 30000                // 0 = no timeout
#   "sandbox": {
#     "useAppContainer": true,        // true -> AppContainer isolation (default)
#     "integrityLevel": "low",        // 'low' (S-1-16-4096)
#     "readDirs": ["..."],            // dirs granted read+execute to the AC SID
#     "writeDirs": ["..."],           // dirs granted modify to the AC SID
#     "workspace": "..."              // sandbox workspace (always read-write)
#   }
# }
#
# The last stdout line that starts with the AARTIQ_SANDBOX_RESULT: marker is a
# JSON result object:
#   AARTIQ_SANDBOX_RESULT:{"exitCode":n,"sandboxed":true,"sandboxPlatform":"win32",
#     "jobAssigned":true,"appContainer":true,"restrictedToken":true,"integrityLevel":"low"}
#   (AppContainer runs report integrityLevel "none": the kernel-built container
#   token carries the isolation; the Low-IL label is applied only on the
#   useAppContainer:false restricted-token path.)
#   AARTIQ_SANDBOX_RESULT:{"error":"...","code":"SANDBOX_SETUP_FAILED","sandboxed":false,"rc":n}
# The target's stdout/stderr are forwarded directly (inherited handles), so the
# marker line is the only reliable way to separate result metadata from output.
# ============================================================================

param([Parameter(Mandatory = $true)][string]$PayloadPath)

$ErrorActionPreference = 'Stop'

function Write-Result([object]$obj) {
  Write-Output ("AARTIQ_SANDBOX_RESULT:" + ($obj | ConvertTo-Json -Compress))
}

try {
  # Read as UTF-8 explicitly: the payload is staged BOM-less by the Node side.
  $payload = Get-Content -Raw -Encoding UTF8 -LiteralPath $PayloadPath | ConvertFrom-Json
} catch {
  Write-Result @{ error = ("SANDBOX_SETUP_FAILED payload: " + $_.Exception.Message); sandboxed = $false }
  exit 1
}

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class JobRunnerNative {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool IsProcessInJob(IntPtr hProcess, IntPtr hJob, out bool bResult);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessAsUserW(
        IntPtr hToken,
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetProcessHeap();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr HeapAlloc(IntPtr hHeap, uint dwFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool HeapFree(IntPtr hHeap, uint dwFlags, IntPtr lpMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, uint dwAttributeCount, uint dwFlags, ref UIntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, UIntPtr Attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessW(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        IntPtr lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    // ---- Token isolation (restricted token + integrity level) ----
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DuplicateTokenEx(
        IntPtr hExistingToken,
        uint dwDesiredAccess,
        IntPtr lpTokenAttributes,
        int ImpersonationLevel,
        int TokenType,
        out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CreateRestrictedToken(
        IntPtr ExistingTokenHandle,
        uint Flags,
        uint DisableSidCount,
        IntPtr SidsToDisable,
        uint DeletePrivilegeCount,
        IntPtr PrivilegesToDelete,
        uint RestrictedSidCount,
        IntPtr SidsToRestrict,
        out IntPtr NewTokenHandle);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetTokenInformation(
        IntPtr TokenHandle,
        int TokenInformationClass,
        IntPtr TokenInformation,
        uint TokenInformationLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool GetTokenInformation(
        IntPtr TokenHandle,
        int TokenInformationClass,
        IntPtr TokenInformation,
        uint TokenInformationLength,
        out uint ReturnLength);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertStringSidToSid(string StringSid, out IntPtr Sid);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertSidToStringSid(IntPtr Sid, out IntPtr StringSid);

    [DllImport("kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr hMem);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll")]
    public static extern void FreeSid(IntPtr pSid);

    // ---- AppContainer profile (userenv.dll; HRESULT-returning) ----
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int CreateAppContainerProfile(string pszAppContainerName, string pszDisplayName, string pszDescription, IntPtr pCapabilities, uint dwCapabilityCount, out IntPtr ppSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int DeriveAppContainerSidFromAppContainerName(string pszAppContainerName, out IntPtr ppsidAppContainerSid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetAppContainerFolderPath(string pszAppContainerName, out IntPtr ppszPath);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int DeleteAppContainerProfile(string pszAppContainerName);

    // ---- Token information class constants ----
    public const int TokenPrivileges = 3;
    public const int TokenIntegrityLevel = 25;
    public const int TokenAppContainerSid = 29;

    // Job object info classes
    public const int JobObjectExtendedLimitInformation = 9;

    // Startup info flags
    public const uint STARTF_USESTDHANDLES = 0x00000100;
    public const int STD_INPUT_HANDLE = -10;
    public const int STD_OUTPUT_HANDLE = -11;
    public const int STD_ERROR_HANDLE = -12;

    // Limit flags
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    public const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    public const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    public const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400;

    // Process creation flags
    public const uint CREATE_SUSPENDED = 0x00000004;
    public const uint CREATE_NO_WINDOW = 0x08000000;
    public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;

    // Proc-thread attribute identifiers (WinBase.h: attribute value encodes the
    // variable-segment count in the low 16 bits).
    public const uint PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;

    // Win32 base errors / HRESULTs
    public const uint ERROR_INSUFFICIENT_BUFFER = 122;
    public const uint ERROR_ALREADY_EXISTS = 183;

    // Token access / duplicate settings
    public const uint TOKEN_QUERY = 0x0008;
    public const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    public const uint TOKEN_DUPLICATE = 0x0002;
    public const uint MAXIMUM_ALLOWED = 0x02000000;
    public const uint DISABLE_MAX_PRIVILEGE = 0x1;

    public const int SecurityImpersonation = 2;
    public const int TokenPrimary = 1;

    // Group/integrity attribute flags
    public const uint SE_GROUP_INTEGRITY = 0x00000020;
    public const uint SE_PRIVILEGE_REMOVED = 0x00000004;

    public const uint WAIT_TIMEOUT = 0x00000102;
    public const uint WAIT_FAILED = 0xFFFFFFFF;

    // Privileges that are never needed by a sandboxed automation process. They
    // are DELETED from the restricted token (not merely disabled) so the child
    // can never enable them, even if a vulnerability rewrites the token.
    // SeChangeNotifyPrivilege (traverse) is intentionally NOT in this list.
    private static readonly string[] DELETED_PRIVILEGES = new string[] {
        "SeDebugPrivilege",
        "SeImpersonatePrivilege",
        "SeAssignPrimaryTokenPrivilege",
        "SeTcbPrivilege",
        "SeCreateTokenPrivilege",
        "SeLoadDriverPrivilege",
        "SeBackupPrivilege",
        "SeRestorePrivilege",
        "SeTakeOwnershipPrivilege",
        "SeIncreaseQuotaPrivilege",
        "SeLockMemoryPrivilege",
        "SeSystemProfilePrivilege",
        "SeSystemtimePrivilege",
        "SeProfileSingleProcessPrivilege",
        "SeIncreaseBasePriorityPrivilege",
        "SeCreatePagefilePrivilege",
        "SeCreatePermanentPrivilege",
        "SeManageVolumePrivilege",
        "SeSecurityPrivilege",
        "SeShutdownPrivilege",
        "SeAuditPrivilege",
        "SeUndockPrivilege",
        "SeSyncAgentPrivilege",
        "SeRelabelPrivilege",
        "SeTrustedCredManAccessPrivilege",
        "SeDelegateSessionUserImpersonatePrivilege",
        "SeMachineAccountPrivilege",
        "SeEnableDelegationPrivilege"
    };

    [StructLayout(LayoutKind.Sequential)]
    public struct LUID {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFOEX {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public IntPtr MinimumWorkingSetSize;
        public IntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public IntPtr ProcessMemoryLimit;
        public IntPtr JobMemoryLimit;
        public IntPtr PeakProcessMemoryUsed;
        public IntPtr PeakJobMemoryUsed;
    }

    // TOKEN_MANDATORY_LABEL contains one SID_AND_ATTRIBUTES (the Low integrity
    // SID with SE_GROUP_INTEGRITY). Structure is exactly one struct - a plain
    // pointer + DWORD pair differs and would corrupt the SID_AND_ATTRIBUTES.
    [StructLayout(LayoutKind.Sequential)]
    public struct TOKEN_MANDATORY_LABEL {
        public SID_AND_ATTRIBUTES Label;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SID_AND_ATTRIBUTES {
        public IntPtr Sid;
        public uint Attributes;
    }

    // SECURITY_CAPABILITIES for the AppContainer (winnt.h). CapabilityCount 0
    // with Capabilities = NULL grants the container NO capabilities => no
    // network access at all.
    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_CAPABILITIES {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        // winnt.h declares Reserved as DWORD: native sizeof is 24 bytes on
        // x64, and UpdateProcThreadAttribute enforces that exact cbSize
        // (a 32-byte layout is rejected with ERROR_INVALID_PARAMETER).
        public uint Reserved;
    }

    // Quote a single argument for a Windows command line (inverse of
    // CommandLineToArgvW). Handles embedded quotes, backslashes, spaces.
    public static string QuoteArg(string a) {
        if (a == null) return "\"\"";
        if (a.Length == 0) return "\"\"";
        bool hasQuote = a.IndexOf('"') >= 0;
        bool hasSpace = false;
        for (int i = 0; i < a.Length; i++) {
            if (a[i] == ' ' || a[i] == '\t' || a[i] == '\n' || a[i] == '\r') { hasSpace = true; break; }
        }
        if (!hasQuote && !hasSpace) return a;
        StringBuilder sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in a) {
            if (c == '\\') {
                backslashes++;
            } else if (c == '"') {
                // cmd.exe consumes this command line directly at process
                // creation, and cmd does not understand CommandLineToArgvW's
                // backslash escaping. Emit quotes literally so 'cmd /c type
                // "C:\path\file"' reaches cmd intact.
                sb.Append('"');
                backslashes = 0;
            } else {
                sb.Append('\\', backslashes);
                sb.Append(c);
                backslashes = 0;
            }
        }
        sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    public static string BuildCommandLine(string exe, string[] args) {
        StringBuilder sb = new StringBuilder();
        sb.Append(QuoteArg(exe));
        if (args != null) {
            foreach (string a in args) {
                sb.Append(' ');
                sb.Append(QuoteArg(a));
            }
        }
        return sb.ToString();
    }

    // Build a double-null-terminated Unicode environment block from a map.
    public static IntPtr BuildEnvBlock(IDictionary<string, string> env) {
        StringBuilder sb = new StringBuilder();
        if (env != null) {
            foreach (KeyValuePair<string, string> kv in env) {
                if (kv.Key == null) continue;
                sb.Append(kv.Key).Append('=').Append(kv.Value ?? string.Empty).Append('\0');
            }
        }
        sb.Append('\0');
        return Marshal.StringToHGlobalUni(sb.ToString());
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    // Get the current process token (TOKEN_QUERY | TOKEN_DUPLICATE). This is
    // the seed for the restricted token.
    public static IntPtr OpenCurrentProcessToken() {
        IntPtr hProc = GetCurrentProcess();
        IntPtr hToken;
        if (!OpenProcessToken(hProc, TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY, out hToken)) {
            return IntPtr.Zero;
        }
        return hToken;
    }

    // Create a primary, duplicate of the seed token (ImpersonationLevel=0,
    // TokenType=Primary) so we never mutate the process's own token.
    public static int CreatePrimaryCopy(IntPtr seed, out IntPtr primary) {
        primary = IntPtr.Zero;
        if (!DuplicateTokenEx(seed, MAXIMUM_ALLOWED, IntPtr.Zero, SecurityImpersonation,
                TokenPrimary, out primary)) {
            return Marshal.GetLastWin32Error();
        }
        return 0;
    }

    // Build a TOKEN_PRIVILEGES buffer whose entries are the LUIDs of the
    // dangerous privileges listed in DELETED_PRIVILEGES. Privileges that do
    // not exist on this system are skipped. Caller frees the returned buffer
    // with Marshal.FreeHGlobal.
    public static IntPtr BuildDeletePrivileges(out uint privilegeCount) {
        List<LUID> luids = new List<LUID>();
        foreach (string name in DELETED_PRIVILEGES) {
            LUID luid;
            if (LookupPrivilegeValue(null, name, out luid)) {
                luids.Add(luid);
            }
        }
        // TOKEN_PRIVILEGES = DWORD PrivilegeCount + LUID_AND_ATTRIBUTES[].
        int per = Marshal.SizeOf(typeof(LUID)) + 4; // LUID + attributes DWORD
        int size = 4 + per * luids.Count;
        IntPtr buf = Marshal.AllocHGlobal(size);
        Marshal.WriteInt32(buf, 0, luids.Count);
        IntPtr cursor = new IntPtr(buf.ToInt64() + 4);
        foreach (LUID luid in luids) {
            Marshal.WriteInt32(cursor, (int)luid.LowPart);
            Marshal.WriteInt32(new IntPtr(cursor.ToInt64() + 4), luid.HighPart);
            Marshal.WriteInt32(new IntPtr(cursor.ToInt64() + 8), (int)SE_PRIVILEGE_REMOVED);
            cursor = new IntPtr(cursor.ToInt64() + per);
        }
        privilegeCount = (uint)luids.Count;
        return buf;
    }

    // Build a restricted token that has the dangerous privileges DELETED and
    // carries the Low mandatory integrity label. Returns 0 on success.
    public static int CreateRestrictedLowToken(IntPtr seed, out IntPtr restricted) {
        restricted = IntPtr.Zero;
        IntPtr lowSid = IntPtr.Zero;
        if (!ConvertStringSidToSid("S-1-16-4096", out lowSid)) {  // S-1-16-4096 = Low
            return Marshal.GetLastWin32Error();
        }
        try {
            uint privCount = 0;
            IntPtr privBuf = BuildDeletePrivileges(out privCount);
            try {
                // Flags = 0 (NOT DISABLE_MAX_PRIVILEGE: we delete the dangerous
                // subset and keep SeChangeNotifyPrivilege so path traversal
                // over the allowlisted directories still resolves).
                if (!CreateRestrictedToken(seed, 0, 0, IntPtr.Zero, privCount, privBuf, 0, IntPtr.Zero, out restricted)) {
                    return Marshal.GetLastWin32Error();
                }
            } finally {
                Marshal.FreeHGlobal(privBuf);
            }
            // Set the Low mandatory integrity label (TokenIntegrityLevel).
            TOKEN_MANDATORY_LABEL label = new TOKEN_MANDATORY_LABEL();
            label.Label.Sid = lowSid;
            label.Label.Attributes = SE_GROUP_INTEGRITY;
            int size = Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL));
            IntPtr labelPtr = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(label, labelPtr, false);
                if (!SetTokenInformation(restricted, TokenIntegrityLevel, labelPtr, (uint)size)) {
                    return Marshal.GetLastWin32Error();
                }
            } finally {
                Marshal.FreeHGlobal(labelPtr);
            }
            return 0;
        } finally {
            // ConvertStringSidToSid returns LocalAlloc'd memory (LocalFree).
            LocalFree(lowSid);
        }
    }

    public static int Run(string exe, string[] args, Dictionary<string, string> env,
        string cwd, int maxProcesses, long maxMemoryBytes, int timeoutMs,
        bool useAppContainer, IntPtr appContainerSid,
        out uint exitCode, out string error, out bool jobAssigned, out bool appContainer, out string integrityLevel) {
        exitCode = 0;
        error = null;
        jobAssigned = false;
        appContainer = false;
        integrityLevel = "none";

        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) {
            error = "CreateJobObject failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
            return 1;
        }

        IntPtr primaryToken = IntPtr.Zero;
        IntPtr restrictedToken = IntPtr.Zero;
        IntPtr envPtr = IntPtr.Zero;
        IntPtr hToken = IntPtr.Zero;

        try {
            // Apply and verify limits BEFORE the target runs.
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            ext.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            if (maxProcesses > 0) {
                ext.BasicLimitInformation.ActiveProcessLimit = (uint)maxProcesses;
                ext.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            }
            if (maxMemoryBytes > 0) {
                ext.JobMemoryLimit = (IntPtr)maxMemoryBytes;
                ext.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
            }

            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr infoPtr = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(ext, infoPtr, false);
            } catch {
                Marshal.FreeHGlobal(infoPtr);
                error = "Failed to marshal job limit information";
                return 2;
            }

            bool limitsApplied = SetInformationJobObject(job, JobObjectExtendedLimitInformation, infoPtr, (uint)size);
            Marshal.FreeHGlobal(infoPtr);
            if (!limitsApplied) {
                error = "SetInformationJobObject failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                return 2;
            }

            // ---- Token isolation ----
            IntPtr seed = OpenCurrentProcessToken();
            if (seed == IntPtr.Zero) {
                error = "OpenProcessToken failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                return 3;
            }
            try {
                int rc = CreatePrimaryCopy(seed, out primaryToken);
                if (rc != 0) {
                    error = "DuplicateTokenEx failed (0x" + rc.ToString("X8") + ")";
                    return 3;
                }
                hToken = primaryToken;
                if (!useAppContainer) {
                    // Non-AppContainer: restricted token (dangerous privileges
                    // deleted) + Low mandatory integrity via CreateProcessAsUserW.
                    rc = CreateRestrictedLowToken(primaryToken, out restrictedToken);
                    if (rc != 0) {
                        error = "CreateRestrictedToken/SetTokenInformation failed (0x" + rc.ToString("X8") + ")";
                        return 3;
                    }
                    hToken = restrictedToken;
                    integrityLevel = "low";
                }
                // AppContainer path: the kernel builds the container token at
                // process start from the SECURITY_CAPABILITIES proc-thread
                // attribute (CreateProcessW). The non-exported token-stamping
                // APIs are not required for this design.
            } finally {
                if (seed != IntPtr.Zero) CloseHandle(seed);
            }

            envPtr = BuildEnvBlock(env);
            string cmdLine = BuildCommandLine(exe, args);

            PROCESS_INFORMATION pi;
            uint flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB;

            if (useAppContainer) {
                // AppContainer via the SECURITY_CAPABILITIES proc-thread
                // attribute list passed to CreateProcessW (kernel32).
                // CreateProcessAsUserW does NOT support this attribute
                // (ERROR_NOT_SUPPORTED); the documented lowbox pattern is
                // CreateProcessW with the current process token. The kernel
                // builds the container token at process start: with
                // CapabilityCount 0 the container gets ZERO capabilities —
                // no network, no device, no user-handle access — from the very
                // first instruction. The profile SID (/ package SID ACL
                // grants) provides the filesystem isolation.
                UIntPtr attrSize = UIntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
                IntPtr attrList = Marshal.AllocHGlobal(new IntPtr((long)attrSize.ToUInt64()));
                bool listInit = false;
                // capsPtr is REFERENCED by the attribute list: the
                // UpdateProcThreadAttribute contract requires lpValue to stay
                // valid until DeleteProcThreadAttributeList. It is freed ONLY
                // in the finally below, after the list is destroyed - never
                // before CreateProcessW. Freeing it early was a
                // use-after-free that surfaced as an intermittent
                // AccessViolationException at JobRunnerNative.CreateProcessW
                // (freed heap is often still mapped, so it passed until the
                // runner image's heap behavior changed).
                IntPtr capsPtr = IntPtr.Zero;
                try {
                    if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref attrSize)) {
                        error = "InitializeProcThreadAttributeList failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                        return 4;
                    }
                    listInit = true;
                    SECURITY_CAPABILITIES caps = new SECURITY_CAPABILITIES();
                    caps.AppContainerSid = appContainerSid;
                    caps.Capabilities = IntPtr.Zero;
                    caps.CapabilityCount = 0;
                    caps.Reserved = 0;
                    capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
                    try {
                        Marshal.StructureToPtr(caps, capsPtr, false);
                    } catch {
                        error = "Failed to marshal SECURITY_CAPABILITIES";
                        return 4;
                    }
                    if (!UpdateProcThreadAttribute(attrList, 0, (UIntPtr)PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, capsPtr,
                            (IntPtr)Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)), IntPtr.Zero, IntPtr.Zero)) {
                        error = "UpdateProcThreadAttribute failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                        return 4;
                    }

                    STARTUPINFOEX siex = new STARTUPINFOEX();
                    siex.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                    siex.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
                    siex.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
                    siex.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
                    siex.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
                    siex.lpAttributeList = attrList;

                    // Marshal the STARTUPINFOEX into unmanaged memory and pass a
                    // pointer: the P/Invoke marshaller's buffered in/out copy of
                    // an embedded STARTUPINFO struct plus attribute list is what
                    // tripped an AccessViolationException in CreateProcessW on
                    // some hosts.
                    IntPtr siexPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(STARTUPINFOEX)));
                    try {
                        Marshal.StructureToPtr(siex, siexPtr, false);
                        // bInheritHandles=true propagates our std handles.
                        if (!CreateProcessW(null, new StringBuilder(cmdLine), IntPtr.Zero, IntPtr.Zero,
                                true, flags | EXTENDED_STARTUPINFO_PRESENT, envPtr, cwd, siexPtr, out pi)) {
                            error = "CreateProcessW failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                            return 4;
                        }
                    } finally {
                        Marshal.FreeHGlobal(siexPtr);
                    }
                    appContainer = true;
                } finally {
                    // Destroy the list FIRST (it still references capsPtr),
                    // then release both buffers. Delete on a list whose
                    // Initialize failed is undefined (the buffer holds
                    // uninitialised memory), hence the listInit guard.
                    if (listInit) DeleteProcThreadAttributeList(attrList);
                    if (capsPtr != IntPtr.Zero) Marshal.FreeHGlobal(capsPtr);
                    Marshal.FreeHGlobal(attrList);
                }
            } else {
                STARTUPINFO baseSi = new STARTUPINFO();
                baseSi.dwFlags = STARTF_USESTDHANDLES;
                baseSi.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
                baseSi.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
                baseSi.hStdError = GetStdHandle(STD_ERROR_HANDLE);
                baseSi.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
                // bInheritHandles=true propagates our std handles.
                if (!CreateProcessAsUserW(hToken, exe, new StringBuilder(cmdLine), IntPtr.Zero, IntPtr.Zero,
                        true, flags, envPtr, cwd, ref baseSi, out pi)) {
                    error = "CreateProcessAsUserW failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                    return 4;
                }
            }

            try {
                // The process is suspended: assign it to the job and verify
                // before it can run a single instruction.
                if (!AssignProcessToJobObject(job, pi.hProcess)) {
                    error = "AssignProcessToJobObject failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                    TerminateProcess(pi.hProcess, 1);
                    return 5;
                }
                bool inJob = false;
                if (!IsProcessInJob(pi.hProcess, job, out inJob) || !inJob) {
                    error = "Job assignment verification failed";
                    TerminateProcess(pi.hProcess, 1);
                    return 6;
                }
                jobAssigned = true;

                // Resume the primary thread (previous suspend count = 1
                // because the process was created suspended). On failure the
                // return value is (DWORD)-1.
                uint resume = ResumeThread(pi.hThread);
                if (resume == uint.MaxValue) {
                    error = "ResumeThread failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                    TerminateProcess(pi.hProcess, 1);
                    return 7;
                }

                uint waitMs = (timeoutMs > 0) ? (uint)timeoutMs : uint.MaxValue;
                uint wait = WaitForSingleObject(pi.hProcess, waitMs);
                if (wait == WAIT_TIMEOUT) {
                    TerminateJobObject(job, 124);
                    error = "TIMEOUT";
                    return 124;
                }
                if (wait == WAIT_FAILED) {
                    error = "WaitForSingleObject failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                    return 8;
                }
                if (!GetExitCodeProcess(pi.hProcess, out exitCode)) {
                    error = "GetExitCodeProcess failed (0x" + Marshal.GetLastWin32Error().ToString("X8") + ")";
                    return 9;
                }
                return 0;
            } finally {
                if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
                if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            }
        } finally {
            if (envPtr != IntPtr.Zero) Marshal.FreeHGlobal(envPtr);
            if (restrictedToken != IntPtr.Zero && restrictedToken != primaryToken) CloseHandle(restrictedToken);
            if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
            // Closing the last job handle triggers KILL_ON_JOB_CLOSE for any
            // process tree still inside the job (orphan cleanup).
            CloseHandle(job);
        }
    }
}
"@

# ---------------------------------------------------------------------------
# Resolve the executable. Bare names are resolved against PATH + PATHEXT.
# ---------------------------------------------------------------------------
$command = [string]$payload.command
$resolved = $null
if ($command -match '[\\/]') {
  $resolved = $command
} else {
  $found = Get-Command $command -ErrorAction SilentlyContinue
  if ($found -and $found.Source) { $resolved = $found.Source }
}
if (-not $resolved -or -not (Test-Path -LiteralPath $resolved)) {
  Write-Result @{ error = ("SANDBOX_SETUP_FAILED resolve: command='$command' resolved='" + $resolved + "'"); sandboxed = $false }
  exit 1
}

# Batch files require cmd.exe interpretation.
$isBatch = $resolved -match '\.(cmd|bat)$'
if ($isBatch) {
  $exe = $env:COMSPEC
  if (-not $exe) { $exe = "$env:WINDIR\System32\cmd.exe" }
  $innerArgs = @()
  if ($payload.args -ne $null) { $innerArgs = @($payload.args) }
  $cmdLine = [JobRunnerNative]::BuildCommandLine($resolved, [string[]]$innerArgs)
  $argsArray = @('/d', '/s', '/c', $cmdLine)
} else {
  $exe = $resolved
  if ($payload.args -ne $null) { $argsArray = @($payload.args) } else { $argsArray = @() }
}

$envDict = New-Object 'System.Collections.Generic.Dictionary[string,string]'
if ($payload.env -ne $null) {
  foreach ($prop in $payload.env.PSObject.Properties) {
    $envDict[$prop.Name] = [string]$prop.Value
  }
}

$cwd = [string]$payload.cwd
$maxProcesses = [int]$payload.maxProcesses
if ($maxProcesses -le 0) { $maxProcesses = 64 }
$maxMemoryBytes = [long]$payload.maxMemoryBytes
if ($maxMemoryBytes -lt 0) { $maxMemoryBytes = 0 }
$timeoutMs = [int]$payload.timeoutMs
if ($timeoutMs -lt 0) { $timeoutMs = 0 }

# ---------------------------------------------------------------------------
# Sandbox profile: AppContainer by default; fail closed if requested and
# unreachable.
# ---------------------------------------------------------------------------
$useAppContainer = $true
$integrityLevel = 'low'
if ($payload.sandbox -ne $null) {
  if ($payload.sandbox.useAppContainer -ne $null) {
    $useAppContainer = [bool]$payload.sandbox.useAppContainer
  }
  if ($payload.sandbox.integrityLevel -ne $null) {
    $integrityLevel = [string]$payload.sandbox.integrityLevel
  }
}
if ($useAppContainer -and $integrityLevel -ne 'low') {
  Write-Result @{ error = 'SANDBOX_POLICY_INVALID'; code = 'SANDBOX_SETUP_FAILED'; sandboxed = $false }
  exit 1
}

# AppContainer name must be a valid Win32 container name. Randomized per run so
# concurrent sandbox commands share no mutable state; the profile is deleted
# again after the run.
$containerName = 'Aartiq.AppContainer.' + ([System.Guid]::NewGuid().ToString('N'))

$readDirs = @()
$writeDirs = @()
$ws = [string]$cwd
if ($payload.sandbox -ne $null) {
  if ($payload.sandbox.readDirs -ne $null) { $readDirs = @($payload.sandbox.readDirs) }
  if ($payload.sandbox.writeDirs -ne $null) { $writeDirs = @($payload.sandbox.writeDirs) }
  if ($payload.sandbox.workspace -ne $null) { $ws = [string]$payload.sandbox.workspace }
}

# ---------------------------------------------------------------------------
# AppContainer profile + OS-ENFORCED directory allowlist.
#
# The allowlist is enforced by the kernel: an AppContainer principal can only
# open an object whose DACL explicitly grants its package SID. We derive the
# package SID by creating the profile, then grant that SID access ONLY to the
# allowlisted directories, the workspace, the resolved executable, and (when it
# lives outside system-standard roots) the executable's directory. Everything
# else stays denied. The grants are removed after the run.
# ---------------------------------------------------------------------------
$script:acSidPtr = [IntPtr]::Zero
$script:acSid = ''
$script:grantedTargets = @()
$script:icaclsPath = Join-Path $env:SystemRoot 'System32\icacls.exe'
$script:acFolder = ''

function Invoke-IntegrityGrant([string]$target, [string]$rights) {
  $arg = "*$script:acSid`:$rights"
  & $script:icaclsPath $target "/grant" $arg *> $null
  return $global:LASTEXITCODE -eq 0
}

function Invoke-IntegrityRevoke([string]$target) {
  & $script:icaclsPath $target "/remove:g" "*$script:acSid" "/t" "/c" *> $null
  return $global:LASTEXITCODE -eq 0
}

# ---------------------------------------------------------------
# Invoke-SandboxSetup - create the AppContainer profile, grant the package SID
# (directory allowlist + workspace + executable), and reroute temp paths.
# Returns $null on success or an error string on failure. On failure, nothing
# else has run and the caller rolls back partial grants.
# ---------------------------------------------------------------
function Invoke-SandboxSetup {
  if (-not $useAppContainer) { return $null }

  # 1. Create the AppContainer profile (idempotent). Returns the package SID.
  $hr = [JobRunnerNative]::CreateAppContainerProfile($containerName, 'Aartiq sandbox', 'Aartiq OS-level sandbox', [IntPtr]::Zero, 0, [ref]$script:acSidPtr)
  if (($hr -eq 0x800700B7) -or ($hr -eq [JobRunnerNative]::ERROR_ALREADY_EXISTS)) {
    $hr = [JobRunnerNative]::DeriveAppContainerSidFromAppContainerName($containerName, [ref]$script:acSidPtr)
  }
  if ($hr -ne 0) {
    return ("CreateAppContainerProfile failed (0x{0:X8})" -f $hr)
  }
  if ($script:acSidPtr -eq [IntPtr]::Zero) {
    return 'AppContainer profile created without a package SID'
  }

  # 2. Package SID as a string for the icacls grants.
  $sidStrPtr = [IntPtr]::Zero
  $sidOk = [JobRunnerNative]::ConvertSidToStringSid($script:acSidPtr, [ref]$sidStrPtr)
  if ($sidOk -and $sidStrPtr -ne [IntPtr]::Zero) {
    $script:acSid = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($sidStrPtr)
    # ConvertSidToStringSid returns LocalAlloc'd memory. Discard the IntPtr
    # return so it cannot leak into the function's pipeline output.
    [void][JobRunnerNative]::LocalFree($sidStrPtr)
  }
  if (-not $script:acSid) {
    return 'AppContainer package SID string conversion failed'
  }

  # 3. AppContainer profile folder -> isolated TEMP/TMP/LOCALAPPDATA.
  #    GetAppContainerFolderPath can return ERROR_NO_SUCH_PACKAGE on some hosts
  #    even though CreateAppContainerProfile succeeded (the Packages\<name>
  #    folder is not provisioned for a name-created container). Fall back to the
  #    canonical location Chromium uses, which the container can access through
  #    its implicit package-folder grant.
  $folderPtr = [IntPtr]::Zero
  $hr2 = [JobRunnerNative]::GetAppContainerFolderPath($containerName, [ref]$folderPtr)
  $script:acFolder = $null
  if ($hr2 -eq 0 -and $folderPtr -ne [IntPtr]::Zero) {
    $script:acFolder = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($folderPtr)
    # GetAppContainerFolderPath returns CoTaskMemAlloc'd memory.
    [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($folderPtr)
  } else {
    $candidate = Join-Path $env:LOCALAPPDATA ('Packages\' + $containerName)
    try {
      New-Item -ItemType Directory -Force -Path $candidate | Out-Null
      $script:acFolder = $candidate
    } catch {
      $script:acFolder = $null
    }
  }
  if (-not $script:acFolder) {
    return ("AppContainer profile folder unavailable (GetAppContainerFolderPath 0x{0:X8})" -f $hr2)
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $script:acFolder 'Temp') | Out-Null
  $envDict['TEMP'] = Join-Path $script:acFolder 'Temp'
  $envDict['TMP'] = Join-Path $script:acFolder 'Temp'
  $envDict['LOCALAPPDATA'] = $script:acFolder

  # 4. OS-enforced directory allowlist grants.
  #    Required (fail closed if they fail): every writable path and the
  #    workspace - without the package-SID ACE the target simply cannot write.
  #    Workspace is always granted read-write.
  if ($ws -and (Test-Path -LiteralPath $ws -PathType Container)) {
    if (-not (Invoke-IntegrityGrant $ws '(OI)(CI)M')) {
      return "Failed to grant workspace access for AppContainer: $ws"
    }
    $script:grantedTargets += ,$ws
  }
  foreach ($d in $writeDirs) {
    if (-not (Test-Path -LiteralPath $d -PathType Container)) { continue }
    if (-not (Invoke-IntegrityGrant $d '(OI)(CI)M')) {
      return "Failed to grant write access for AppContainer: $d"
    }
    $script:grantedTargets += ,$d
  }
  # Read-only allowlist entries: best-effort. A failed read grant merely
  # keeps the path DENIED (the fail-closed direction); it never widens the
  # allowlist. The target surfaces its own access error if it actually needs
  # the path.
  foreach ($d in $readDirs) {
    if (-not (Test-Path -LiteralPath $d -PathType Container)) { continue }
    if (-not (Invoke-IntegrityGrant $d '(OI)(CI)RX')) {
      [Console]::Error.WriteLine("WIN SANDBOX: could not grant read access to $d (package SID) - path will stay denied")
    } else {
      $script:grantedTargets += ,$d
    }
  }

  # 5. Executable access. System-standard roots already carry the
  #    ALL APPLICATION PACKAGES ACE; anything else (node in AppData, python
  #    venvs, ...) needs the package SID so the AppContainer can launch it.
  $exeDir = Split-Path -Parent $resolved
  $standardRoots = @("$env:SystemRoot", "$env:ProgramFiles", "${env:ProgramFiles(x86)}")
  $inStandardRoot = $false
  foreach ($r in $standardRoots) {
    if ($r -and $exeDir.StartsWith($r, [System.StringComparison]::OrdinalIgnoreCase)) { $inStandardRoot = $true; break }
  }
  if (-not $inStandardRoot) {
    if (-not (Invoke-IntegrityGrant $exeDir '(OI)(CI)RX')) {
      return "Failed to grant executable directory access for AppContainer: $exeDir"
    }
    $script:grantedTargets += ,$exeDir
    if (-not (Invoke-IntegrityGrant $exe '(RX)')) {
      return "Failed to grant executable access for AppContainer: $exe"
    }
    $script:grantedTargets += ,$exe
  }

  return $null
}

function Invoke-SandboxCleanup {
  if (-not $useAppContainer) { return }
  foreach ($t in $script:grantedTargets) {
    try { Invoke-IntegrityRevoke $t | Out-Null } catch { }
  }
  try { [JobRunnerNative]::DeleteAppContainerProfile($containerName) | Out-Null } catch { }
  if ($script:acFolder) { Remove-Item -LiteralPath $script:acFolder -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:acSidPtr -ne [IntPtr]::Zero) {
    [JobRunnerNative]::FreeSid($script:acSidPtr)
    $script:acSidPtr = [IntPtr]::Zero
  }
}

$setupError = Invoke-SandboxSetup

if ($setupError) {
  # Roll back any grants/profile created before the failure.
  Invoke-SandboxCleanup
  Write-Result @{ error = $setupError; code = 'SANDBOX_SETUP_FAILED'; sandboxed = $false }
  exit 1
}

# ---------------------------------------------------------------------------
# Execute.
# ---------------------------------------------------------------------------
$exitCode = [uint32]0
$errorMsg = $null
$jobAssigned = $false
$appContainerApplied = $false
$integrityApplied = 'none'
try {
  $rc = [JobRunnerNative]::Run($exe, [string[]]$argsArray, $envDict, $cwd, $maxProcesses, $maxMemoryBytes, $timeoutMs, $useAppContainer, $script:acSidPtr, [ref]$exitCode, [ref]$errorMsg, [ref]$jobAssigned, [ref]$appContainerApplied, [ref]$integrityApplied)
} finally {
  # Cleanup runs even when the target timed out or the helper was signalled:
  # revoke ACL grants, delete the AppContainer profile, and remove its folder.
  Invoke-SandboxCleanup
}

if ($rc -eq 0) {
  Write-Result @{
    exitCode = [int]$exitCode
    sandboxed = $true
    sandboxPlatform = 'win32'
    jobAssigned = $jobAssigned
    appContainer = $appContainerApplied
    restrictedToken = $useAppContainer
    integrityLevel = $integrityApplied
  }
} else {
  $msg = $errorMsg
  if ($rc -eq 124) { $msg = 'TIMEOUT' }
  Write-Result @{ error = $msg; code = 'SANDBOX_SETUP_FAILED'; sandboxed = $false; rc = $rc }
  if ($rc -eq 124) { exit 124 } else { exit 1 }
}