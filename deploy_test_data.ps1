# ------------------------------------------------------------------------------
# deploy_test_data.ps1: put the ShiftBoard demo data into the database (Phase 35.3.1)
#
# The PowerShell twin of deploy_test_data.sh: same commands, same options, same
# checks. Use this one on Windows (or anywhere PowerShell runs) and the .sh one
# on Linux / macOS. Keep the two files in step.
#
# Runs the Docker commands for you, from the folder this file is in (the
# repository root), so it works no matter where you call it from:
#
#   .\deploy_test_data.ps1                  load the demo data into the running stack
#   .\deploy_test_data.ps1 status           show what's loaded (changes nothing)
#   .\deploy_test_data.ps1 reset            remove the demo data and load it again, dated from now
#   .\deploy_test_data.ps1 clear            remove the demo data only
#
# Its own options (they can go anywhere after the command):
#   --demo-copy    use the separate demo copy (docker-compose.demo.yaml, project
#                  "shiftboard-demo") instead of the normal stack
#   --start        if the stack isn't running, start it first (docker compose up -d --build)
#   -y, --yes      don't ask before reset / clear
#   -h, --help     show this text
#
# Everything else is passed to the loader unchanged:
#   --weeks-back 8  --weeks-ahead 3  --seed 35  --password 'Demo12345!'
#   --manager-email you@yourdomain.com      (repeatable)
#
# Examples:
#   .\deploy_test_data.ps1 load --weeks-back 12 --manager-email you@yourdomain.com
#   .\deploy_test_data.ps1 load --demo-copy --start
#   .\deploy_test_data.ps1 reset -y
#
# If Windows says "running scripts is disabled on this system", run it this way
# (this allows only this one run and changes no setting):
#   powershell -ExecutionPolicy Bypass -File .\deploy_test_data.ps1 load
#
# It only ever adds or removes the demo venues and the accounts ending in
# @demo.example.com. It never runs "down", never deletes a volume, and never
# reads a settings file. Works in Windows PowerShell 5.1 and PowerShell 7.
# See docs/DEPLOYMENT.md.
# ------------------------------------------------------------------------------

# Docker writes progress to the error stream. With 'Stop', Windows PowerShell 5.1
# would treat the first such line as a failure, so results are checked with
# $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'

$DemoProject = 'shiftboard-demo'
$DemoFile = 'docker-compose.demo.yaml'
$WaitSeconds = 180
if ("$env:WAIT_SECONDS" -match '^\d+$') { $WaitSeconds = [int]$env:WAIT_SECONDS }

function Show-Usage {
    # the comment block at the top of this file, without the "# " prefix
    Get-Content -LiteralPath $PSCommandPath |
        Select-Object -Skip 1 -First 38 |
        ForEach-Object { $_ -replace '^# ?', '' } |
        Write-Host
}

function Write-Err([string]$Message) { [Console]::Error.WriteLine($Message) }

# ---- what was asked for ----------------------------------------------------
$rest = @($args | ForEach-Object { "$_" })
$action = 'load'
if ($rest.Count -gt 0 -and @('load', 'reset', 'clear', 'status') -contains $rest[0]) {
    $action = $rest[0].ToLower()
    $rest = @($rest | Select-Object -Skip 1)
}

$demoCopy = $false
$start = $false
$assumeYes = $false
$showHelp = $false
$loaderArgs = @()
foreach ($a in $rest) {
    switch -Regex ($a) {
        '^(--demo-copy|-DemoCopy)$' { $demoCopy = $true; break }
        '^(--start|-Start)$'        { $start = $true; break }
        '^(-y|--yes|-Yes)$'         { $assumeYes = $true; break }
        '^(-h|--help|-Help|-\?)$'   { $showHelp = $true; break }
        default                     { $loaderArgs += $a }
    }
}

if ($showHelp) {
    Show-Usage
    exit 0
}

$script:ExitCode = 0

function Invoke-Deploy {
    # ---- checks --------------------------------------------------------------
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'docker was not found. Install Docker (Docker Desktop on Windows / macOS) first.'
    }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) { throw "'docker compose' is not available. Docker Compose v2 is needed." }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "Docker isn't running. Start Docker, then run this again." }

    $mainFile = ''
    foreach ($f in @('docker-compose.yaml', 'docker-compose.yml')) {
        if (Test-Path -LiteralPath $f -PathType Leaf) { $mainFile = $f; break }
    }
    if (-not $mainFile) { throw "No docker-compose.yaml in $((Get-Location).Path). This file belongs in the repository root." }
    if (-not (Test-Path -LiteralPath 'backend/src/demo_data.py' -PathType Leaf)) {
        throw 'backend/src/demo_data.py is missing. Apply Phase 35.3 first.'
    }

    if ($demoCopy) {
        if (-not (Test-Path -LiteralPath $DemoFile -PathType Leaf)) { throw "$DemoFile is missing. Apply Phase 35.3 first." }
        $dc = @('compose', '-p', $DemoProject, '-f', $mainFile, '-f', $DemoFile)
        $where = "the separate demo copy ($DemoProject)"
    }
    else {
        $dc = @('compose')
        $where = 'the normal stack'
    }
    $dcText = 'docker ' + ($dc -join ' ')

    # ---- make sure the stack is up -------------------------------------------
    Write-Host "Target: $where"
    $services = @(& docker @dc ps --status running --services 2>$null | ForEach-Object { "$_".Trim() })
    if ($services -notcontains 'backend') {
        if ($start) {
            Write-Host "The backend isn't running. Starting the stack: $dcText up -d --build"
            & docker @dc up -d --build
            if ($LASTEXITCODE -ne 0) { throw "Starting the stack failed (exit code $LASTEXITCODE)." }
        }
        else {
            throw "The backend isn't running in $where.`nStart it with:   $dcText up -d --build`nor run this again with --start."
        }
    }

    # The loader needs the tables, which the backend creates when it starts. "status"
    # only reads, so it is the readiness check.
    Write-Host "Waiting for the backend and the database (up to ${WaitSeconds}s)..."
    $waited = 0
    $last = @()
    while ($true) {
        $last = @(& docker @dc exec -T backend python -m src.demo_data status 2>&1 | ForEach-Object { "$_" })
        if ($LASTEXITCODE -eq 0) { break }
        if ($waited -ge $WaitSeconds) {
            $last | ForEach-Object { Write-Err $_ }
            throw "The backend didn't answer within ${WaitSeconds}s. Check: $dcText logs backend"
        }
        Start-Sleep -Seconds 3
        $waited += 3
    }

    if ($action -eq 'status') {
        $last | ForEach-Object { Write-Host $_ }
        return
    }

    # ---- reset / clear remove things, so ask first -----------------------------
    if ($action -eq 'reset' -or $action -eq 'clear') {
        $last | ForEach-Object { Write-Host $_ }
        Write-Host ''
        Write-Host "'$action' deletes the five demo venues and every account ending in @demo.example.com,"
        Write-Host 'including anything testers did inside those venues. Your own venues and accounts are not touched.'
        if (-not $assumeYes) {
            $redirected = $false
            try { $redirected = [Console]::IsInputRedirected } catch { $redirected = $false }
            if ($redirected -or -not [Environment]::UserInteractive) {
                throw "Not asking for confirmation because this isn't an interactive terminal. Add -y to go ahead."
            }
            $answer = Read-Host 'Type yes to continue'
            if ($answer -cne 'yes') { throw 'Stopped. Nothing was changed.' }
        }
    }

    # ---- do it ---------------------------------------------------------------
    Write-Host ''
    & docker @dc exec -T backend python -m src.demo_data $action @loaderArgs | Out-Host
    $rc = $LASTEXITCODE
    if ($rc -ne 0) {
        if ($action -eq 'load') {
            Write-Host ''
            Write-Err 'If the demo data is already loaded, use:  .\deploy_test_data.ps1 reset'
        }
        $script:ExitCode = $rc
        return
    }

    if ($action -ne 'clear') {
        Write-Host ''
        if ($demoCopy) {
            Write-Host 'Web app (demo copy): http://localhost:5183 (unless you changed DEMO_PORT_FRONTEND in .env)'
        }
        else {
            Write-Host 'Open the web app the way you normally do and sign in with one of the logins above.'
        }
    }
}

# Work from this file's folder, and put the caller back where they were afterwards.
Push-Location -LiteralPath $PSScriptRoot
try {
    Invoke-Deploy
}
catch {
    Write-Err ("ERROR: " + $_.Exception.Message)
    $script:ExitCode = 1
}
finally {
    Pop-Location
}
exit $script:ExitCode
