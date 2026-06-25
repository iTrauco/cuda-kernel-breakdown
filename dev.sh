#!/usr/bin/env bash
# dev.sh - single-terminal launcher for the cuda lab.
# Starts the vite frontend and the node backend together, shows a live
# status panel, tears both down cleanly on ctrl-c.
set -uo pipefail
cd "$(dirname "$0")"

# ---- per-node config (edit per machine, e.g. node01 vs node02) ----
CONDA_ENV="cuda-kernel-breakdown"
FRONT_PORT=5173
BACK_PORT=8787
INTERVAL=2

LAB="lab"
LOGDIR="$(mktemp -d)"
FRONT_LOG="$LOGDIR/frontend.log"
BACK_LOG="$LOGDIR/backend.log"

R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'
BLU=$'\033[34m'; CYN=$'\033[36m'; MAG=$'\033[35m'

CONDA_BASE="$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")"

port_up() { ss -ltn 2>/dev/null | grep -q ":$1 "; }

free_stale() {
  for p in "$FRONT_PORT" "$BACK_PORT"; do
    local pids
    pids="$(ss -ltnp 2>/dev/null | grep ":$p " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
    if [ -n "$pids" ]; then
      printf "${YEL}freeing stale port %s (pid %s)${R}\n" "$p" "$(echo $pids | tr '\n' ' ')"
      echo "$pids" | xargs -r kill 2>/dev/null
      sleep 1
    fi
  done
}

cleanup() {
  printf "\n${DIM}shutting down...${R}\n"
  for pid in "${FRONT_PID:-}" "${BACK_PID:-}"; do
    [ -n "$pid" ] && kill -- -"$pid" 2>/dev/null
  done
  sleep 1
  rm -rf "$LOGDIR"
  printf "${DIM}stopped.${R}\n"
  exit 0
}
trap cleanup INT TERM

if [ ! -d "$LAB/node_modules" ]; then
  printf "${YEL}installing deps (first run)...${R}\n"
  ( cd "$LAB" && npm install ) || { echo "npm install failed"; exit 1; }
fi

free_stale

# frontend
setsid bash -c "cd '$LAB' && exec npm run dev" > "$FRONT_LOG" 2>&1 &
FRONT_PID=$!

# backend, inside conda env so nvcc/ncu are on PATH
setsid bash -c "
  source '$CONDA_BASE/etc/profile.d/conda.sh' 2>/dev/null
  conda activate '$CONDA_ENV' 2>/dev/null
  cd '$LAB' && exec node server/index.js
" > "$BACK_LOG" 2>&1 &
BACK_PID=$!

state_of() {
  local pid="$1" port="$2"
  if ! kill -0 "$pid" 2>/dev/null; then echo "CRASHED"; return; fi
  if port_up "$port"; then echo "UP"; else echo "STARTING"; fi
}
badge() {
  case "$1" in
    UP)       printf "${GRN}* UP      ${R}";;
    STARTING) printf "${YEL}~ STARTING${R}";;
    CRASHED)  printf "${RED}x CRASHED ${R}";;
  esac
}

while true; do
  fs="$(state_of "$FRONT_PID" "$FRONT_PORT")"
  bs="$(state_of "$BACK_PID" "$BACK_PORT")"

  clear
  printf "${B}${CYN}  CUDA LAB${R}  ${DIM}launcher  refresh ${INTERVAL}s  %s${R}\n" "$(date '+%H:%M:%S')"
  printf "  ${DIM}branch:${R} ${MAG}%s${R}\n" "$(git branch --show-current 2>/dev/null || echo '?')"
  printf "${DIM}  ------------------------------------------------------------${R}\n"
  printf "  %-10s %s   ${DIM}http://localhost:%s${R}  ${DIM}pid %s${R}\n" "frontend" "$(badge "$fs")" "$FRONT_PORT" "$FRONT_PID"
  printf "  %-10s %s   ${DIM}http://localhost:%s${R}  ${DIM}pid %s${R}\n" "backend"  "$(badge "$bs")" "$BACK_PORT"  "$BACK_PID"
  printf "${DIM}  ------------------------------------------------------------${R}\n"
  printf "  ${B}frontend log${R}\n"
  tail -n 5 "$FRONT_LOG" 2>/dev/null | sed 's/^/    /'
  printf "  ${B}backend log${R}\n"
  tail -n 5 "$BACK_LOG" 2>/dev/null | sed 's/^/    /'
  printf "${DIM}  ------------------------------------------------------------${R}\n"
  [ "$bs" = "CRASHED" ] && printf "  ${RED}backend down: check conda env '%s' / nvcc on PATH${R}\n" "$CONDA_ENV"
  printf "  ${DIM}ctrl-c to stop both${R}\n"

  sleep "$INTERVAL"
done
