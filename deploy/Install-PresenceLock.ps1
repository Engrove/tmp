<#
.SYNOPSIS
    Installs or updates PresenceLock for all users of this computer. No MSI, no code signing.

.DESCRIPTION
    Copies PresenceLock.exe (+ PresenceLock.exe.config) to "%ProgramFiles%\PresenceLock" and
    registers a per-user autostart at logon (the agent always runs as the logged-on user,
    never elevated):
      -Autostart RunKey  (default) HKLM\...\CurrentVersion\Run
      -Autostart Task    Scheduled Task from PresenceLock-LogonTask.xml (restarts on failure)

    -Guard additionally installs the "PresenceLock Guard" service (LocalSystem, automatic):
      * starts the agent in every interactive session, restarts it if it disappears;
      * with computer policy AllowUserExit = 0 ("NIS2 mode") it LOCKS a session whose agent
        disappeared, and logs it to the Application event log (source PresenceLock, ID 1001);
      * keeps a protected, user-read-only copy of each user's profile in
        "%ProgramFiles%\PresenceLock\state" so a deleted or demoted profile is restored.

    Idempotent: files are only copied when their hash differs, so it is safe to run at every
    boot as a GPO computer startup script (runs as SYSTEM). The guard service is stopped while
    the exe is replaced (it runs from the same file). A file that is in use is skipped and
    retried at the next run. Log: %ProgramData%\PresenceLock\install.log

.EXAMPLE
    # GPO: Computer Configuration > Policies > Windows Settings > Scripts > Startup > (Scripts tab)
    #   Script name:       powershell.exe
    #   Script parameters: -NoProfile -ExecutionPolicy Bypass -File \\corp.example\NETLOGON\PresenceLock\Install-PresenceLock.ps1 -Guard
#>
[CmdletBinding()]
param(
    [string]$Source = $PSScriptRoot,
    [ValidateSet('RunKey', 'Task')]
    [string]$Autostart = 'RunKey',
    [switch]$Guard
)

$ErrorActionPreference = 'Stop'
$target      = Join-Path $env:ProgramFiles 'PresenceLock'
$state       = Join-Path $target 'state'
$files       = @('PresenceLock.exe', 'PresenceLock.exe.config')
$logDir      = Join-Path $env:ProgramData 'PresenceLock'
$logFile     = Join-Path $logDir 'install.log'
$runKey      = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
$serviceName = 'PresenceLockGuard'
$serviceKey  = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"

function Write-Log([string]$Message) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Add-Content -Path $logFile -Value ('{0:u}  {1}' -f (Get-Date), $Message)
}

# .NET Framework 4.8 is built into Windows 10 1903+ and Windows 11 (Release >= 528040).
$ndp = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
if (-not $ndp -or $ndp.Release -lt 528040) {
    Write-Log ".NET Framework 4.8 not present (Release=$($ndp.Release)); aborting"
    exit 1
}

New-Item -ItemType Directory -Force -Path $target | Out-Null

# Which files changed?
$changed = @()
foreach ($f in $files) {
    $src = Join-Path $Source $f
    $dst = Join-Path $target $f
    if (-not (Test-Path -LiteralPath $src)) { Write-Log "source missing: $src"; exit 1 }
    if (-not (Test-Path -LiteralPath $dst) -or
        ((Get-FileHash -LiteralPath $src).Hash -ne (Get-FileHash -LiteralPath $dst).Hash)) {
        $changed += $f
    }
}

# The guard service runs from the same exe: stop it while the file is replaced.
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($changed.Count -gt 0 -and $service -and $service.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force
    (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
}

foreach ($f in $changed) {
    try {
        Copy-Item -LiteralPath (Join-Path $Source $f) -Destination (Join-Path $target $f) -Force
        Unblock-File -LiteralPath (Join-Path $target $f)    # drop Mark-of-the-Web if the source carried one
        Write-Log "updated $f"
    }
    catch {
        Write-Log "could not replace $f (in use?), retry next run: $($_.Exception.Message)"
    }
}

$exe = Join-Path $target 'PresenceLock.exe'
if ($Autostart -eq 'RunKey') {
    Set-ItemProperty -Path $runKey -Name 'PresenceLock' -Value ('"{0}"' -f $exe)
    if (Get-ScheduledTask -TaskName 'PresenceLock' -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName 'PresenceLock' -Confirm:$false
    }
}
else {
    Remove-ItemProperty -Path $runKey -Name 'PresenceLock' -ErrorAction SilentlyContinue
    $xml = Get-Content -LiteralPath (Join-Path $Source 'PresenceLock-LogonTask.xml') -Raw
    Register-ScheduledTask -TaskName 'PresenceLock' -Xml $xml -Force | Out-Null
}

if ($Guard) {
    # Protected state folder: SYSTEM + Administrators only, owner Administrators, no inheritance
    # (the service re-applies the same ACL at every start).
    New-Item -ItemType Directory -Force -Path $state | Out-Null
    & icacls.exe $state /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    & icacls.exe $state /setowner '*S-1-5-32-544' | Out-Null

    if (-not [System.Diagnostics.EventLog]::SourceExists('PresenceLock')) {
        [System.Diagnostics.EventLog]::CreateEventSource('PresenceLock', 'Application')
    }

    # QUOTED image path: an unquoted path containing spaces is a privilege-escalation vector.
    $binPath = '"{0}" --service' -f $exe
    if (-not $service) {
        New-Service -Name $serviceName -BinaryPathName $binPath -DisplayName 'PresenceLock Guard' `
            -Description 'Keeps the PresenceLock agent running in every session; locks a session if it is stopped.' `
            -StartupType Automatic | Out-Null
    }
    else {
        # sc.exe "binPath=" loses embedded quotes in Windows PowerShell 5.1; write ImagePath directly.
        Set-ItemProperty -Path $serviceKey -Name 'ImagePath' -Value $binPath
        Set-Service -Name $serviceName -StartupType Automatic
    }
    # Restart the service if it ever fails (5 s, 5 s, then 30 s; counter reset after a day).
    & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
    Start-Service -Name $serviceName
    Write-Log "guard service installed and running"
}
elseif ($service -and $changed.Count -gt 0) {
    Start-Service -Name $serviceName                         # was stopped for the update above
}

Write-Log "installed (autostart=$Autostart, guard=$([bool]$Guard), .NET release $($ndp.Release))"
exit 0
