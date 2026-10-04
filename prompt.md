# Phase 35.3.1: Demo Data Script for PowerShell (v0.35.5)

**Why:** ShiftBoard is deployed from both Linux and Windows. Phase 35.3 added `deploy_test_data.sh` for bash; this phase adds the same script for PowerShell, and fixes one stray line at the end of the bash script.

## What changes
* **NEW `deploy_test_data.ps1`** (repository root): the PowerShell twin of `deploy_test_data.sh`.
  * Same commands (`load`, `reset`, `clear`, `status`; no command = `load`), same options (`--start`, `--demo-copy`, `-y`, `-h`, and every loader option passed through), same checks, same messages.
  * It works in Windows PowerShell 5.1 and PowerShell 7. It switches to its own folder to run Docker and puts the caller back afterwards.
  * It never runs `down`, never deletes a volume, never reads a settings file, and changes no PowerShell or Windows setting.
* **FIX `deploy_test_data.sh`:** in the repo, the file ends with a stray line of three backticks (the Markdown fence was copied in with the script). Bash runs the load and then reports a syntax error on that line and exits with code 2. The line is removed, and the header now points Windows users to the `.ps1`.
* `docs/DEPLOYMENT.md`, README, CHANGELOG and `agy_system_instructions.md` describe both scripts.
* **Version 0.35.5.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**
* **No database, API or frontend change besides the version.**

## 0. Rules for this phase
* Touch only the 8 files named below. Nothing in `backend/` except `backend/src/version.py`; nothing in `frontend/` except `frontend/package.json`; no settings file (`.env`, anything in `.secrets/`).
* **Do NOT run either script, do NOT run any `docker compose` command, and do NOT run `Set-ExecutionPolicy` or change any other system setting.** Andrew runs the scripts himself (Part R).
* **Code fences are not file content.** In this prompt every file and every Find / Replace block is wrapped in lines of three backticks. Those lines are Markdown. Never write them into a file. This is the mistake that Edit 2 of A2 cleans up.
  - `deploy_test_data.ps1`: the first line is `# ----...` (a `#` and dashes) and the **last line is `exit $script:ExitCode`**.
  - `deploy_test_data.sh`: after A2 the first line is `#!/usr/bin/env bash` and the **last line is `fi`**.
  - When you finish, open both files and confirm the last lines. Neither file contains a line of backticks.
* `deploy_test_data.ps1` is plain ASCII. Save it as UTF-8 without BOM; either line ending works. `deploy_test_data.sh` keeps LF line endings (never CRLF).
* **EDITS:** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order.
* **Verification.** All 7 edited files were checked against your repo and match (0.35.4 is fully applied, apart from the stray line in `deploy_test_data.sh`).
  - **`deploy_test_data.ps1`** was run in PowerShell 7.4 through 18 cases with a stand-in `docker` command that recorded every call and ran the real loader against a real Postgres:
    - `load`, `status`, `reset`, `clear`, on the normal stack and with `--demo-copy`, called from a different folder; the caller's folder is restored
    - options with spaces passed through intact; a bad option's error and exit code passed back
    - a second `load` refused, with the hint to use `reset`
    - `reset` continued on "yes", stopped on "no", and refused without `-y` when there is no terminal
    - backend not running (with and without `--start`), backend never ready (times out and shows the last error), Docker not running, file not in the repository root
    - a CRLF copy runs the same
    - The recorded Docker calls are the same ones the bash script makes.
  - PSScriptAnalyzer: no parse errors, and no syntax that Windows PowerShell 5.1 can't run (`PSUseCompatibleSyntax` for 5.1 and 7.0). Its only notes are about `Write-Host`, which is intended for a console script.
  - **It was not run in Windows PowerShell 5.1 itself, on Windows, or against a real Docker daemon.** The first run there is the first real run.
  - **`deploy_test_data.sh`** after A2: `bash -n` and ShellCheck clean, and the full `load` / `status` / `clear` cycle re-run.

  Don't "improve" them.

---

# PART A: The scripts and the guide

## A1. NEW FILE `deploy_test_data.ps1`
In the repository root, next to `deploy_test_data.sh`. Create it; don't run it. **The last line of the file is `exit $script:ExitCode`.**

```powershell
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
```

---

## A2. `deploy_test_data.sh` (EDITS)
Two changes: the header comment, and the stray last line. Keep LF line endings.

**Edit 1.** Find:
```bash
# It only ever adds or removes the demo venues and the accounts ending in
# @demo.example.com. It never runs "down", never deletes a volume, and never
# reads a settings file. On Windows run it from Git Bash or WSL.
# See docs/DEPLOYMENT.md.
# ------------------------------------------------------------------------------
```
Replace with:
```bash
# It only ever adds or removes the demo venues and the accounts ending in
# @demo.example.com. It never runs "down", never deletes a volume, and never
# reads a settings file. On Windows use deploy_test_data.ps1 (the same thing for
# PowerShell), or run this one from Git Bash or WSL. Keep the two files in step.
# See docs/DEPLOYMENT.md.
# ------------------------------------------------------------------------------
```

**Edit 2.** Delete the **last line** of the file. That line is nothing but three backtick characters: a Markdown code fence that was copied into the file by mistake in Phase 35.3. Delete only that line.

After this edit the last two lines of the file are `  fi` and `fi`, and no line in the file contains a backtick fence.

---

## A3. `docs/DEPLOYMENT.md` (EDITS)
Section C (the Shortcut) and one sentence in section D.

**Edit 1.** Find:
```markdown
```

**Shortcut:** `deploy_test_data.sh` in the repository root runs these commands for you. It checks that Docker and the backend are running, waits for the database, and then loads:

```bash
```
Replace with:
```markdown
```

**Shortcut:** two scripts in the repository root run these commands for you. They do the same thing and take the same options; use whichever fits the computer you're on. Each one checks that Docker and the backend are running, waits for the database, and then loads.

Linux, macOS, Git Bash or WSL (`deploy_test_data.sh`):

```bash
```

**Edit 2.** Find:
```markdown
```

* It works from any folder, because it switches to the folder it is in before running Docker.
* Loader options (the table under **Options** below) go after the command and are passed through unchanged.
* Its own options are `--start` (start the stack first if it isn't running), `--demo-copy` (use the separate copy from setup D) and `-y`.
* It never runs `down`, never deletes a volume, and never reads a settings file.
* On Windows, run it from Git Bash or WSL. In PowerShell, use the `docker compose` commands directly.

It prints the logins when it finishes:
```
Replace with:
```markdown
```

Windows PowerShell (`deploy_test_data.ps1`):

```powershell
.\deploy_test_data.ps1                    # the same as "load"
.\deploy_test_data.ps1 status
.\deploy_test_data.ps1 reset              # asks first; add -y to skip the question
.\deploy_test_data.ps1 clear
.\deploy_test_data.ps1 load --weeks-back 12 --manager-email you@yourdomain.com
```

* They work from any folder, because each switches to the folder it is in before running Docker. The PowerShell one puts you back where you were when it finishes.
* Loader options (the table under **Options** below) go after the command and are passed through unchanged.
* Their own options are `--start` (start the stack first if it isn't running), `--demo-copy` (use the separate copy from setup D) and `-y`.
* They never run `down`, never delete a volume, and never read a settings file.
* If Windows says *running scripts is disabled on this system*, run it this way. It allows this one run only and changes no setting:
  `powershell -ExecutionPolicy Bypass -File .\deploy_test_data.ps1 load`
* The PowerShell script works in Windows PowerShell 5.1 and PowerShell 7 (`pwsh ./deploy_test_data.ps1` on Linux or macOS).
* The two scripts must stay in step: a change to one goes into the other.

It prints the logins when it finishes:
```

**Edit 3.** Find:
```markdown
```

Or both steps in one: `bash deploy_test_data.sh load --demo-copy --start`. Add `--demo-copy` to `status`, `reset` and `clear` as well.

| | Normal stack | Demo copy |
```
Replace with:
```markdown
```

Or both steps in one: `bash deploy_test_data.sh load --demo-copy --start` (PowerShell: `.\deploy_test_data.ps1 load --demo-copy --start`). Add `--demo-copy` to `status`, `reset` and `clear` as well.

| | Normal stack | Demo copy |
```

---

## A4. `agy_system_instructions.md` (EDITS)
One tree line and one sentence added to rule 8. Leave the Standing rules section exactly as it is.

**Edit 1.** Find:
```markdown
├── docs/DEPLOYMENT.md       # deploying with or without demo data
├── deploy_test_data.sh      # runs the demo data loader's Docker commands (LF line endings)
├── .env                     # ordinary settings, NO secrets. Ignored by git.
├── .env.template            # documents every ordinary setting
```
Replace with:
```markdown
├── docs/DEPLOYMENT.md       # deploying with or without demo data
├── deploy_test_data.sh      # runs the demo data loader's Docker commands (LF line endings)
├── deploy_test_data.ps1     # the same for Windows PowerShell; keep the two in step
├── .env                     # ordinary settings, NO secrets. Ignored by git.
├── .env.template            # documents every ordinary setting
```

**Edit 2.** Find:
```markdown
6. **Don't touch `.secrets/*` in `.gitignore`** (ignoring `.secrets/` itself untracks the templates).
7. Changing settings needs `docker compose up -d --force-recreate`, NOT `down -v` (that deletes the database).
8. **Demo data (Phase 35.3):** `backend/src/demo_data.py` builds the full demo data set with the models. When a phase adds a table or a required column, update it in the same phase so `python -m src.demo_data load` still works. Demo accounts always end in `@demo.example.com`; never give them real addresses.
```
Replace with:
```markdown
6. **Don't touch `.secrets/*` in `.gitignore`** (ignoring `.secrets/` itself untracks the templates).
7. Changing settings needs `docker compose up -d --force-recreate`, NOT `down -v` (that deletes the database).
8. **Demo data (Phase 35.3):** `backend/src/demo_data.py` builds the full demo data set with the models. When a phase adds a table or a required column, update it in the same phase so `python -m src.demo_data load` still works. Demo accounts always end in `@demo.example.com`; never give them real addresses. `deploy_test_data.sh` (bash) and `deploy_test_data.ps1` (PowerShell) run the loader and must behave the same: a change to one goes into the other in the same phase.
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.4",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.5",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.4"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.5"
```

---

## V3. `CHANGELOG.md` (EDIT)
The new section goes above `[0.35.4]`.

**Edit 1.** Find:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.4] - 2026-10-02 - Phase 35.3: Demo data and deployment guide
```
Replace with:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.5] - 2026-10-02 - Phase 35.3.1: Demo data script for PowerShell

### Added
- **`deploy_test_data.ps1`** in the repository root: the PowerShell twin of `deploy_test_data.sh`, for deploying from Windows (`.\deploy_test_data.ps1 [load | reset | clear | status]`).
  - Same commands, options, checks and messages as the bash script: `--start`, `--demo-copy`, `-y`, and every loader option passed through.
  - Works in Windows PowerShell 5.1 and PowerShell 7, and puts you back in the folder you started in.

### Fixed
- `deploy_test_data.sh` ended with a stray code-fence line, which made bash report a syntax error after a successful load. The line is removed.

### Changed
- `docs/DEPLOYMENT.md`, README and `agy_system_instructions.md` describe both scripts.

## [0.35.4] - 2026-10-02 - Phase 35.3: Demo data and deployment guide
```

---

## V4. `README.md` (EDITS)

**Edit 1.** Find:
```markdown
backend/src/demo_data.py   the full demo data loader: python -m src.demo_data load | reset | clear | status
deploy_test_data.sh        runs the loader's Docker commands for you: bash deploy_test_data.sh [load | reset | clear | status]
docker-compose.demo.yaml   a separate demo copy of the stack (own database, other ports)
docs/DEPLOYMENT.md         deploying with or without demo data
```
Replace with:
```markdown
backend/src/demo_data.py   the full demo data loader: python -m src.demo_data load | reset | clear | status
deploy_test_data.sh        runs the loader's Docker commands for you: bash deploy_test_data.sh [load | reset | clear | status]
deploy_test_data.ps1       the same for Windows PowerShell: .\deploy_test_data.ps1 [load | reset | clear | status]
docker-compose.demo.yaml   a separate demo copy of the stack (own database, other ports)
docs/DEPLOYMENT.md         deploying with or without demo data
```

**Edit 2.** Find:
```markdown
| Clean (real use) | `SEED_DEMO_ACCOUNTS=false`, `SHOW_DEMO_LOGINS=false` in `.env` |
| Starter demo accounts | the default: the accounts in the table above |
| Full demo data | `bash deploy_test_data.sh` (or `docker compose exec backend python -m src.demo_data load`): five venues, about 115 people, weeks of history, something live today. `reset` refreshes the dates, `clear` removes exactly the demo data. |
| Full demo data in a separate copy | `docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml up -d --build`, then the same loader inside it (or both in one: `bash deploy_test_data.sh load --demo-copy --start`). Its own database, on http://localhost:5183. |

**Everyday commands**
```
Replace with:
```markdown
| Clean (real use) | `SEED_DEMO_ACCOUNTS=false`, `SHOW_DEMO_LOGINS=false` in `.env` |
| Starter demo accounts | the default: the accounts in the table above |
| Full demo data | `bash deploy_test_data.sh` on Linux / macOS, `.\deploy_test_data.ps1` in Windows PowerShell (or `docker compose exec backend python -m src.demo_data load`): five venues, about 115 people, weeks of history, something live today. `reset` refreshes the dates, `clear` removes exactly the demo data. |
| Full demo data in a separate copy | `docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml up -d --build`, then the same loader inside it (or both in one: `bash deploy_test_data.sh load --demo-copy --start`, or `.\deploy_test_data.ps1 load --demo-copy --start`). Its own database, on http://localhost:5183. |

**Everyday commands**
```

---

# PART R: For Andrew: using it (AGY: don't run any of this)

No database change, so no SQL and no rebuild. Restart the frontend once so it shows 0.35.5: `docker compose restart frontend`.

**Windows PowerShell** (from any folder):
```powershell
.\deploy_test_data.ps1                           # load into the running stack
.\deploy_test_data.ps1 status
.\deploy_test_data.ps1 reset                     # asks first; -y skips the question
.\deploy_test_data.ps1 clear
.\deploy_test_data.ps1 load --demo-copy --start  # start the separate copy and load it
```

If Windows says *running scripts is disabled on this system*, use this form. It allows that one run only and changes no setting:
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy_test_data.ps1 load
```

**Linux:** `bash deploy_test_data.sh ...` with the same commands and options.

### Checklist
1. Admin → System: *Web app 0.35.5 · Server 0.35.5*.
2. The last line of `deploy_test_data.sh` is `fi`, and the last line of `deploy_test_data.ps1` is `exit $script:ExitCode`.
3. Windows: `.\deploy_test_data.ps1 status` prints what's loaded and your own venue and account counts, then `$LASTEXITCODE` is 0.
4. Linux: `bash deploy_test_data.sh status; echo $?` prints the same and ends with 0 (no "unexpected EOF" message).

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.35.5. Apply it as written and don't bump again.)