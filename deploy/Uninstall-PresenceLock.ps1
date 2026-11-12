<#
.SYNOPSIS
    Removes PresenceLock from this computer (run as administrator or SYSTEM).

.PARAMETER RemoveUserProfiles
    Also delete every user's learned profile (C:\Users\*\AppData\Local\PresenceLock).
    Without it, profiles stay so a later reinstall continues where it left off.
#>
[CmdletBinding()]
param([switch]$RemoveUserProfiles)

$ErrorActionPreference = 'Continue'
$target = Join-Path $env:ProgramFiles 'PresenceLock'

Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'PresenceLock' -ErrorAction SilentlyContinue
if (Get-ScheduledTask -TaskName 'PresenceLock' -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName 'PresenceLock' -Confirm:$false
}

Get-Process -Name 'PresenceLock' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue

if ($RemoveUserProfiles) {
    Get-ChildItem -Path (Join-Path $env:SystemDrive 'Users') -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'AppData\Local\PresenceLock' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        ForEach-Object { Remove-Item -LiteralPath $_ -Recurse -Force -ErrorAction SilentlyContinue }
}
exit 0
