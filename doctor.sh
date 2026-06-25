#!/usr/bin/env bash
# doctor.sh - live health dashboard for the cuda lab. read-only, changes nothing.
# loops and refreshes so you can leave it up while you build.
# usage: ./doctor.sh [interval_seconds]   (default 3, "once" for a single pass)
set -uo pipefail
cd "$(dirname "$0")"

CONDA_ENV="cuda-kernel-breakdown"
FRONT_PORT=5173
BACK_PORT=8787
LAB="lab"
INTERVAL="${1:-3}"

R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; MAG=$'\033[35m'

# activate the env ONCE up front so PATH persists for every check below
CONDA_BASE="$(conda info --base 2>/dev/null || echo "$HOME/miniconda3")"
set +u
source "$CONDA_BASE/etc/profile.d/conda.sh" 2>/dev/null
conda activate "$CONDA_ENV" 2>/dev/null
set -u

port_up() { ss -ltn 2>/dev/null | grep -q ":$1 "; }

run_checks() {
  pass=0; fail=0; warn=0
  OUT=""
  ok()  { OUT+="$(printf "  ${GRN}* PASS${R}  %-22s ${DIM}%s${R}\n" "$1" "$2")"$'\n'; pass=$((pass+1)); }
  no()  { OUT+="$(printf "  ${RED}x FAIL${R}  %-22s ${DIM}%s${R}\n" "$1" "$2")"$'\n'; fail=$((fail+1)); }
  meh() { OUT+="$(printf "  ${YEL}~ WARN${R}  %-22s ${DIM}%s${R}\n" "$1" "$2")"$'\n'; warn=$((warn+1)); }
  sec() { OUT+="$(printf "\n${B}${CYN}%s${R}\n" "$1")"$'\n'; }

  sec "repo"
  if git rev-parse --git-dir >/dev/null 2>&1; then
    ok "git repo" "branch $(git branch --show-current 2>/dev/null)"
    dirty="$(git status --short | wc -l)"
    [ "$dirty" -eq 0 ] && ok "working tree" "clean" || meh "working tree" "$dirty uncommitted file(s)"
  else
    no "git repo" "not a git repo here"
  fi

  sec "gpu + driver"
  if command -v nvidia-smi >/dev/null 2>&1; then
    gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
    drv="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)"
    maxcuda="$(nvidia-smi 2>/dev/null | grep -o 'CUDA Version: [0-9.]*' | awk '{print $3}')"
    util="$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)"
    mem="$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr ',' '/' | tr -d ' ')"
    ok "gpu visible" "$gpu"
    ok "driver" "$drv  (max cuda $maxcuda)"
    ok "gpu live" "util ${util}%  mem ${mem} MiB"
  else
    no "nvidia-smi" "no driver / no gpu on this node"
  fi

  sec "toolchain (env '$CONDA_ENV')"
  if conda env list 2>/dev/null | grep -q "$CONDA_ENV"; then
    ok "conda env" "active: $CONDA_PREFIX"
    nvcc_v="$(nvcc --version 2>/dev/null | grep -o 'release [0-9.]*' | awk '{print $2}')"
    if [ -n "$nvcc_v" ]; then
      ok "nvcc" "release $nvcc_v"
      if [ -n "${maxcuda:-}" ]; then
        awk "BEGIN{exit !($nvcc_v > $maxcuda)}" && \
          no "nvcc vs driver" "nvcc $nvcc_v > driver max $maxcuda (PTX mismatch risk)" || \
          ok "nvcc vs driver" "nvcc $nvcc_v <= driver max $maxcuda"
      fi
    else
      no "nvcc" "not on PATH in env"
    fi
    ncu_path="$(which ncu 2>/dev/null)"
    [ -n "$ncu_path" ] && ok "ncu" "$ncu_path" || no "ncu" "not on PATH in env"
  else
    no "conda env" "'$CONDA_ENV' not found"
  fi

  sec "node project"
  if [ -f "$LAB/package.json" ]; then
    ok "package.json" "present"
    [ -d "$LAB/node_modules" ] && ok "node_modules" "installed" || no "node_modules" "cd lab && npm install"
  else
    no "package.json" "missing at $LAB/"
  fi

  sec "live processes"
  port_up "$FRONT_PORT" && ok "frontend :$FRONT_PORT" "listening" || meh "frontend :$FRONT_PORT" "not running (dev.sh)"
  port_up "$BACK_PORT"  && ok "backend :$BACK_PORT"  "listening" || meh "backend :$BACK_PORT"  "not running (dev.sh)"

  sec "profiling permission"
  if [ -n "${ncu_path:-}" ]; then
    perm="$(grep -o 'RmProfilingAdminOnly: [0-9]' /proc/driver/nvidia/params 2>/dev/null | awk '{print $2}')"
    if   [ "$perm" = "0" ]; then ok  "ncu counters" "unrestricted (no sudo needed)"
    elif [ "$perm" = "1" ]; then meh "ncu counters" "admin-only (profiling needs sudo)"
    else meh "ncu counters" "could not read RmProfilingAdminOnly"; fi
  else
    meh "ncu counters" "skipped (no ncu)"
  fi

  sec "known issues in tree"
  if [ -f "$LAB/index.html" ] && [ -f "$LAB/src/main.js" ]; then
    if grep -q 'runner-root' "$LAB/src/main.js"; then
      grep -q 'runner-root' "$LAB/index.html" \
        && ok "runner mount" "#runner-root exists in index.html" \
        || no "runner mount" "main.js targets #runner-root, absent in index.html"
    fi
    dupes="$(grep -c 'createWorkloadRunner()' "$LAB/src/main.js")"
    [ "$dupes" -gt 1 ] && meh "runner mount" "createWorkloadRunner() called $dupes times (double-mount bug)" || true
  fi
}

draw() {
  run_checks
  clear
  printf "${B}${CYN}CUDA LAB DOCTOR${R}  ${DIM}%s  host %s  refresh %ss${R}\n" \
    "$(date '+%H:%M:%S')" "$(hostname)" "$INTERVAL"
  printf "%s" "$OUT"
  printf "${DIM}------------------------------------------------------------${R}\n"
  printf "  ${GRN}%d pass${R}   ${YEL}%d warn${R}   ${RED}%d fail${R}    " "$pass" "$warn" "$fail"
  [ "$fail" -eq 0 ] && printf "${GRN}chain intact.${R}\n" || printf "${RED}broken links, fix top-down.${R}\n"
  printf "${DIM}  ctrl-c to stop${R}\n"
}

if [ "$INTERVAL" = "once" ]; then
  INTERVAL=0; draw; exit 0
fi

trap 'printf "\n${DIM}stopped.${R}\n"; exit 0' INT TERM
while true; do
  draw
  sleep "$INTERVAL"
done
