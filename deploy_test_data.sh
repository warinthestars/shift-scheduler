#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# deploy_test_data.sh: put the ShiftBoard demo data into the database (Phase 35.3)
#
# Runs the Docker commands for you, from the folder this file is in (the
# repository root), so it works no matter where you call it from:
#
#   bash deploy_test_data.sh                  load the demo data into the running stack
#   bash deploy_test_data.sh status           show what's loaded (changes nothing)
#   bash deploy_test_data.sh reset            remove the demo data and load it again, dated from now
#   bash deploy_test_data.sh clear            remove the demo data only
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
#   bash deploy_test_data.sh load --weeks-back 12 --manager-email you@yourdomain.com
#   bash deploy_test_data.sh load --demo-copy --start
#   bash deploy_test_data.sh reset -y
#
# It only ever adds or removes the demo venues and the accounts ending in
# @demo.example.com. It never runs "down", never deletes a volume, and never
# reads a settings file. On Windows use deploy_test_data.ps1 (the same thing for
# PowerShell), or run this one from Git Bash or WSL. Keep the two files in step.
# See docs/DEPLOYMENT.md.
# ------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

DEMO_PROJECT="shiftboard-demo"
DEMO_FILE="docker-compose.demo.yaml"
WAIT_SECONDS="${WAIT_SECONDS:-180}"

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  # the comment block at the top of this file, without the "# " prefix
  sed -n '3,33p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
}

# ---- what was asked for ----------------------------------------------------
action="load"
case "${1:-}" in
  load|reset|clear|status) action="$1"; shift ;;
esac

demo_copy=0
start=0
assume_yes=0
loader_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --demo-copy) demo_copy=1 ;;
    --start)     start=1 ;;
    -y|--yes)    assume_yes=1 ;;
    -h|--help)   usage; exit 0 ;;
    *)           loader_args+=("$1") ;;
  esac
  shift
done

# ---- checks ----------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker was not found. Install Docker (Docker Desktop on Windows / macOS) first."
docker compose version >/dev/null 2>&1 || die "'docker compose' is not available. Docker Compose v2 is needed."
docker info >/dev/null 2>&1 || die "Docker isn't running. Start Docker, then run this again."

main_file=""
for f in docker-compose.yaml docker-compose.yml; do
  if [ -f "$f" ]; then main_file="$f"; break; fi
done
[ -n "$main_file" ] || die "No docker-compose.yaml in $(pwd). This file belongs in the repository root."
[ -f backend/src/demo_data.py ] || die "backend/src/demo_data.py is missing. Apply Phase 35.3 first."

if [ "$demo_copy" -eq 1 ]; then
  [ -f "$DEMO_FILE" ] || die "$DEMO_FILE is missing. Apply Phase 35.3 first."
  dc=(docker compose -p "$DEMO_PROJECT" -f "$main_file" -f "$DEMO_FILE")
  where="the separate demo copy ($DEMO_PROJECT)"
else
  dc=(docker compose)
  where="the normal stack"
fi

loader() { "${dc[@]}" exec -T backend python -m src.demo_data "$@"; }

backend_running() {
  local services
  services="$("${dc[@]}" ps --status running --services 2>/dev/null || true)"
  services="${services//$'\r'/}"
  case $'\n'"$services"$'\n' in
    *$'\n'backend$'\n'*) return 0 ;;
  esac
  return 1
}

# ---- make sure the stack is up ----------------------------------------------
echo "Target: $where"
if ! backend_running; then
  if [ "$start" -eq 1 ]; then
    echo "The backend isn't running. Starting the stack: ${dc[*]} up -d --build"
    "${dc[@]}" up -d --build
  else
    die "The backend isn't running in $where.
Start it with:   ${dc[*]} up -d --build
or run this again with --start."
  fi
fi

# The loader needs the tables, which the backend creates when it starts. "status"
# only reads, so it is the readiness check.
echo "Waiting for the backend and the database (up to ${WAIT_SECONDS}s)..."
waited=0
last=""
until last="$(loader status 2>&1)"; do
  if [ "$waited" -ge "$WAIT_SECONDS" ]; then
    echo "$last" >&2
    die "The backend didn't answer within ${WAIT_SECONDS}s. Check: ${dc[*]} logs backend"
  fi
  sleep 3
  waited=$((waited + 3))
done

if [ "$action" = "status" ]; then
  echo "$last"
  exit 0
fi

# ---- reset / clear remove things, so ask first --------------------------------
if [ "$action" = "reset" ] || [ "$action" = "clear" ]; then
  echo "$last"
  echo
  echo "'$action' deletes the five demo venues and every account ending in @demo.example.com,"
  echo "including anything testers did inside those venues. Your own venues and accounts are not touched."
  if [ "$assume_yes" -ne 1 ]; then
    [ -t 0 ] || die "Not asking for confirmation because this isn't an interactive terminal. Add -y to go ahead."
    printf "Type yes to continue: "
    read -r answer
    [ "$answer" = "yes" ] || die "Stopped. Nothing was changed."
  fi
fi

# ---- do it -------------------------------------------------------------------
echo
status=0
loader "$action" ${loader_args[@]+"${loader_args[@]}"} || status=$?
if [ "$status" -ne 0 ]; then
  if [ "$action" = "load" ]; then
    echo
    echo "If the demo data is already loaded, use:  bash deploy_test_data.sh reset" >&2
  fi
  exit "$status"
fi

if [ "$action" != "clear" ]; then
  echo
  if [ "$demo_copy" -eq 1 ]; then
    echo "Web app (demo copy): http://localhost:5183 (unless you changed DEMO_PORT_FRONTEND in .env)"
  else
    echo "Open the web app the way you normally do and sign in with one of the logins above."
  fi
fi
