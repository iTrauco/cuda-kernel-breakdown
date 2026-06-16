#!/usr/bin/env bash
# Standalone GPU + kernel observability. Refreshes on a timer, independent of edits.
# Usage: ./observe.sh [interval_seconds]   (default 2)
cd "$(dirname "$0")"
source ./config.sh

INTERVAL="${1:-2}"

R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[34m'; CYN=$'\033[36m'; MAG=$'\033[35m'

METRICS="gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed,\
l1tex__throughput.avg.pct_of_peak_sustained_active,\
lts__throughput.avg.pct_of_peak_sustained_active,\
sm__throughput.avg.pct_of_peak_sustained_active,\
launch__registers_per_thread,\
sm__warps_active.avg.pct_of_peak_sustained_active"

declare -A LABEL=(
  [gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed]="DRAM Throughput"
  [l1tex__throughput.avg.pct_of_peak_sustained_active]="L1/TEX Throughput"
  [lts__throughput.avg.pct_of_peak_sustained_active]="L2 Throughput"
  [sm__throughput.avg.pct_of_peak_sustained_active]="Compute (SM) Throughput"
  [launch__registers_per_thread]="Registers / Thread"
  [sm__warps_active.avg.pct_of_peak_sustained_active]="Achieved Occupancy"
)
ORDER=(
  gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed
  l1tex__throughput.avg.pct_of_peak_sustained_active
  lts__throughput.avg.pct_of_peak_sustained_active
  sm__throughput.avg.pct_of_peak_sustained_active
  sm__warps_active.avg.pct_of_peak_sustained_active
  launch__registers_per_thread
)

hr() { printf "${DIM}%s${R}\n" "------------------------------------------------------------"; }

while true; do
  clear
  printf "${B}${CYN}  CUDA OBSERVABILITY${R}  ${DIM}refresh ${INTERVAL}s${R}\n"
  printf "  ${DIM}branch:${R} ${MAG}%s${R}   ${DIM}arch:${R} ${MAG}%s${R}   ${DIM}%s${R}\n" \
    "$(git branch --show-current 2>/dev/null || echo '?')" "$ARCH" "$(date '+%H:%M:%S')"
  hr

  # ---- live GPU state (nvidia-smi, always available) ----
  printf "  ${B}GPU${R}\n"
  nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw \
    --format=csv,noheader,nounits 2>/dev/null | \
    awk -v c="$BLU" -v r="$R" '{printf "    util %s%s%%%s  mem-util %s%s%%%s  mem %s%s/%s MiB%s  temp %s%s C%s  pwr %s%s W%s\n", c,$1,r, c,$2,r, c,$3,$4,r, c,$5,r, c,$6,r}'
  hr

  # ---- last kernel profile ----
  printf "  ${B}LAST KERNEL PROFILE${R}  ${DIM}(%s)${R}\n" "$BIN"
  if [ -x "./$BIN" ]; then
    raw=$(ncu --metrics "$METRICS" "./$BIN" 2>&1)
    if echo "$raw" | grep -q "ERR_NVGPUCTRPERM"; then
      printf "    ${RED}counter permission denied (ERR_NVGPUCTRPERM)${R}\n"
    elif echo "$raw" | grep -q "No kernels were profiled"; then
      printf "    ${YEL}no kernels profiled${R}\n"
    else
      for m in "${ORDER[@]}"; do
        val=$(echo "$raw" | grep -m1 -F "$m" | awk '{print $NF}')
        [ -z "$val" ] && val="-"
        printf "    %-26s ${BLU}%12s${R}\n" "${LABEL[$m]}" "$val"
      done
    fi
  else
    printf "    ${DIM}no build yet (run ./run.sh)${R}\n"
  fi
  hr
  printf "  ${DIM}ctrl-c to stop${R}\n"

  sleep "$INTERVAL"
done
