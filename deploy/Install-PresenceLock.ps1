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

    Idempotent and verified (review F08): it is safe to run at every boot as a GPO computer
    startup script (runs as SYSTEM).
      1. the source files are checked against RELEASE-MANIFEST.json (SHA-256, version);
      2. changed files are copied to a staging folder and checked again;
      3. each target file is renamed to *.old (possible even while a running agent uses it),
         the staged file moved in and its hash read back; any failure rolls ALL files back;
      4. icacls / sc / service results are checked;
      5. the installed exe's hash and file version are read back against the manifest.
    Exit code 0 ONLY when the manifest's version is the active one; 1 on any failure (the
    previous version stays in place). Agents already running keep the old image until the
    next logon; the guard is restarted on the new one immediately.
    Log: %ProgramData%\PresenceLock\install.log (rotated at 256 KB, one previous file kept).

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
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 256KB) {
        Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
    }
    Add-Content -Path $logFile -Value ('{0:u}  {1}' -f (Get-Date), $Message)
}

function Fail([string]$Message) {
    Write-Log "FAILED: $Message"
    exit 1
}

function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

try {
    # .NET Framework 4.8 is built into Windows 10 1903+ and Windows 11 (Release >= 528040).
    $ndp = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if (-not $ndp -or $ndp.Release -lt 528040) { Fail ".NET Framework 4.8 not present (Release=$($ndp.Release))" }

    # 1. Source verified against the release manifest (protects against partial copies and
    #    corruption on the share; protection against tampering is the share's ACL).
    $manifestPath = Join-Path $Source 'RELEASE-MANIFEST.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { Fail "RELEASE-MANIFEST.json missing in $Source" }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($f in $files) {
        $src = Join-Path $Source $f
        if (-not (Test-Path -LiteralPath $src)) { Fail "source missing: $src" }
        $expected = $manifest.files.$f
        if (-not $expected) { Fail "manifest has no hash for $f" }
        if ((Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash -ne $expected) { Fail "source $f does not match the manifest" }
    }

    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Get-ChildItem -LiteralPath $target -Filter '*.old' -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }   # from earlier updates, once unused

    $changed = @($files | Where-Object {
        $dst = Join-Path $target $_
        -not (Test-Path -LiteralPath $dst) -or (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -ne $manifest.files.$_
    })

    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    $serviceWasRunning = $service -and $service.Status -ne 'Stopped'

    if ($changed.Count -gt 0) {
        # 2. Stage and verify.
        $staging = Join-Path $target ('.staging-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        try {
            foreach ($f in $changed) {
                Copy-Item -LiteralPath (Join-Path $Source $f) -Destination (Join-Path $staging $f) -Force
                Unblock-File -LiteralPath (Join-Path $staging $f)
                if ((Get-FileHash -LiteralPath (Join-Path $staging $f) -Algorithm SHA256).Hash -ne $manifest.files.$f) { throw "staged $f corrupt" }
            }

            # The guard service runs from the same exe: stop it while files are swapped.
            if ($serviceWasRunning) {
                Stop-Service -Name $serviceName -Force
                (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
            }

            # 3. Swap all files, or none.
            $swapped = @()
            try {
                foreach ($f in $changed) {
                    $dst = Join-Path $target $f
                    if (Test-Path -LiteralPath $dst) { Move-Item -LiteralPath $dst -Destination "$dst.old" -Force }
                    Move-Item -LiteralPath (Join-Path $staging $f) -Destination $dst -Force
                    $swapped += $f
                    if ((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -ne $manifest.files.$f) { throw "installed $f does not match the manifest" }
                    Write-Log "updated $f"
                }
            }
            catch {
                foreach ($f in $swapped) {
                    $dst = Join-Path $target $f
                    if (Test-Path -LiteralPath "$dst.old") { Move-Item -LiteralPath "$dst.old" -Destination $dst -Force }
                }
                if ($serviceWasRunning) { Start-Service -Name $serviceName -ErrorAction SilentlyContinue }
                throw "update rolled back: $($_.Exception.Message)"
            }
        }
        finally { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
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
        # 4. Protected state folder: SYSTEM + Administrators only, owner Administrators, no inheritance.
        New-Item -ItemType Directory -Force -Path $state | Out-Null
        Invoke-Checked 'icacls (grant)' { & icacls.exe $state /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' }
        Invoke-Checked 'icacls (owner)' { & icacls.exe $state /setowner '*S-1-5-32-544' }

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
        if ((Get-ItemProperty -Path $serviceKey -Name 'ImagePath').ImagePath -ne $binPath) { throw "service ImagePath not set" }
        # Restart the service if it ever fails (5 s, 5 s, then 30 s; counter reset after a day).
        Invoke-Checked 'sc failure' { & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/5000/restart/30000 }
        Start-Service -Name $serviceName
        (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
        Write-Log "guard service installed and running"
    }
    elseif ($serviceWasRunning -or ($service -and $changed.Count -gt 0)) {
        Start-Service -Name $serviceName                     # was stopped for the update above
        (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
    }

    # 5. Read back: the active exe IS the manifest's release.
    $activeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    $activeVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
    if ($activeHash -ne $manifest.files.'PresenceLock.exe') { Fail "active exe hash $activeHash is not the manifest's" }
    if ($manifest.fileVersion -and $activeVersion -ne $manifest.fileVersion) { Fail "active exe version $activeVersion, manifest $($manifest.fileVersion)" }

    Write-Log "installed and verified: version $activeVersion, commit $($manifest.commit), sha256 $activeHash (autostart=$Autostart, guard=$([bool]$Guard), .NET release $($ndp.Release))"
    exit 0
}
catch {
    Fail $_.Exception.Message
}
