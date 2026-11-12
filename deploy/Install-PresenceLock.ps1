<#
.SYNOPSIS
    Installs or updates PresenceLock for all users of this computer. No MSI, no code signing.

.DESCRIPTION
    Copies PresenceLock.exe (+ PresenceLock.exe.config) to "%ProgramFiles%\PresenceLock" and
    registers a per-user autostart at logon (the agent always runs as the logged-on user,
    never elevated):
      -Autostart RunKey  (default) HKLM\...\CurrentVersion\Run
      -Autostart Task    Scheduled Task from PresenceLock-LogonTask.xml (restarts on failure)

    Idempotent: files are only copied when their hash differs, so it is safe to run at every
    boot as a GPO computer startup script (runs as SYSTEM). A file that is in use is skipped
    and retried at the next run. Log: %ProgramData%\PresenceLock\install.log

.EXAMPLE
    # GPO: Computer Configuration > Policies > Windows Settings > Scripts > Startup > (Scripts tab)
    #   Script name:       powershell.exe
    #   Script parameters: -NoProfile -ExecutionPolicy Bypass -File \\corp.example\NETLOGON\PresenceLock\Install-PresenceLock.ps1
#>
[CmdletBinding()]
param(
    [string]$Source = $PSScriptRoot,
    [ValidateSet('RunKey', 'Task')]
    [string]$Autostart = 'RunKey'
)

$ErrorActionPreference = 'Stop'
$target  = Join-Path $env:ProgramFiles 'PresenceLock'
$files   = @('PresenceLock.exe', 'PresenceLock.exe.config')
$logDir  = Join-Path $env:ProgramData 'PresenceLock'
$logFile = Join-Path $logDir 'install.log'
$runKey  = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'

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
foreach ($f in $files) {
    $src = Join-Path $Source $f
    $dst = Join-Path $target $f
    if (-not (Test-Path -LiteralPath $src)) { Write-Log "source missing: $src"; exit 1 }
    if ((Test-Path -LiteralPath $dst) -and
        ((Get-FileHash -LiteralPath $src).Hash -eq (Get-FileHash -LiteralPath $dst).Hash)) {
        continue
    }
    try {
        Copy-Item -LiteralPath $src -Destination $dst -Force
        Unblock-File -LiteralPath $dst          # drop Mark-of-the-Web if the source carried one
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

Write-Log "installed (autostart=$Autostart, .NET release $($ndp.Release))"
exit 0
