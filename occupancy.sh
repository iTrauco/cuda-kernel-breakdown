#!/usr/bin/env bash
# Standalone occupancy / warp / thread-slot observer.
# Refreshes on a timer. Usage: ./occupancy.sh [interval_seconds]  (default 3)
cd "$(dirname "$0")"
source ./config.sh

INTERVAL="${1:-3}"

R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[34m'; CYN=$'\033[36m'; MAG=$'\033[35m'

# Metrics pulled from ncu. If any name is rejected on your ncu version,
# it'll show in the raw error and we trim it.
METRICS="launch__grid_size,\
launch__block_size,\
launch__thread_count,\
launch__registers_per_thread,\
launch__shared_mem_per_block_static,\
launch__waves_per_multiprocessor,\
launch__occupancy_limit_blocks,\
launch__occupancy_limit_registers,\
launch__occupancy_limit_shared_mem,\
launch__occupancy_limit_warps,\
sm__warps_active.avg.pct_of_peak_sustained_active,\
sm__warps_active.avg.per_cycle_active,\
sm__maximum_warps_avg_per_active_cycle"

declare -A LABEL=(
  [launch__grid_size]="Grid Size (blocks)"
  [launch__block_size]="Block Size (threads)"
  [launch__thread_count]="Total Threads"
  [launch__registers_per_thread]="Registers / Thread"
  [launch__shared_mem_per_block_static]="Shared Mem / Block"
  [launch__waves_per_multiprocessor]="Waves / SM"
  [launch__occupancy_limit_blocks]="Limit: Blocks"
  [launch__occupancy_limit_registers]="Limit: Registers"
  [launch__occupancy_limit_shared_mem]="Limit: Shared Mem"
  [launch__occupancy_limit_warps]="Limit: Warps"
  [sm__warps_active.avg.pct_of_peak_sustained_active]="Achieved Occupancy"
  [sm__warps_active.avg.per_cycle_active]="Active Warps / Cycle (avg)"
  [sm__maximum_warps_avg_per_active_cycle]="Max Warps / Cycle"
)

# render order, grouped
GEOMETRY=( launch__grid_size launch__block_size launch__thread_count )
RESOURCES=( launch__registers_per_thread launch__shared_mem_per_block_static )
OCCUPANCY=( sm__warps_active.avg.pct_of_peak_sustained_active sm__warps_active.avg.per_cycle_active sm__maximum_warps_avg_per_active_cycle launch__waves_per_multiprocessor )
LIMITERS=( launch__occupancy_limit_blocks launch__occupancy_limit_registers launch__occupancy_limit_shared_mem launch__occupancy_limit_warps )

hr()   { printf "${DIM}%s${R}\n" "------------------------------------------------------------"; }
val_of() { echo "$RAW" | grep -m1 -F "$1" | awk '{print $NF}'; }

row() {
  local m="$1"; local v; v=$(val_of "$m"); [ -z "$v" ] && v="-"
  printf "    %-26s ${BLU}%14s${R}\n" "${LABEL[$m]}" "$v"
}

# color the occupancy % row specially
occ_row() {
  local m="$1"; local v; v=$(val_of "$m"); [ -z "$v" ] && v="-"
  local n=${v%.*}; local c="$BLU"
  if [[ "$n" =~ ^[0-9]+$ ]]; then
    if   [ "$n" -lt 33 ]; then c="$RED"
    elif [ "$n" -lt 66 ]; then c="$YEL"
    else c="$GRN"; fi
  fi
  printf "    %-26s ${c}%13s%%${R}\n" "${LABEL[$m]}" "$v"
}

while true; do
  RAW=$($NCU --metrics "$METRICS" "./$BIN" 2>&1)

  clear
  printf "${B}${CYN}  OCCUPANCY / WARP OBSERVER${R}  ${DIM}refresh ${INTERVAL}s${R}\n"
  printf "  ${DIM}branch:${R} ${MAG}%s${R}   ${DIM}arch:${R} ${MAG}%s${R}   ${DIM}%s${R}\n" \
    "$(git branch --show-current 2>/dev/null || echo '?')" "$ARCH" "$(date '+%H:%M:%S')"
  hr

  if echo "$RAW" | grep -q "ERR_NVGPUCTRPERM"; then
    printf "  ${RED}counter permission denied (ERR_NVGPUCTRPERM)${R}\n"; hr; sleep "$INTERVAL"; continue
  fi
  if echo "$RAW" | grep -q "No kernels were profiled"; then
    printf "  ${YEL}no kernels profiled (launch failed / no build)${R}\n"; hr; sleep "$INTERVAL"; continue
  fi

  printf "  ${B}LAUNCH GEOMETRY${R}\n"
  for m in "${GEOMETRY[@]}"; do row "$m"; done
  # derived: warps per block, total warps (pure launch math, no device assumptions)
  bs=$(val_of launch__block_size); tc=$(val_of launch__thread_count)
  if [[ "$bs" =~ ^[0-9]+$ ]] && [ "$bs" -gt 0 ]; then
    printf "    %-26s ${MAG}%14s${R}\n" "Warps / Block (derived)" "$((bs/32))"
  fi
  if [[ "$tc" =~ ^[0-9]+$ ]]; then
    printf "    %-26s ${MAG}%14s${R}\n" "Total Warps (derived)" "$((tc/32))"
  fi
  hr

  printf "  ${B}PER-THREAD RESOURCES${R}\n"
  for m in "${RESOURCES[@]}"; do row "$m"; done
  hr

  printf "  ${B}OCCUPANCY${R}\n"
  occ_row sm__warps_active.avg.pct_of_peak_sustained_active
  row sm__warps_active.avg.per_cycle_active
  row sm__maximum_warps_avg_per_active_cycle
  row launch__waves_per_multiprocessor
  hr

  printf "  ${B}OCCUPANCY LIMITERS${R}  ${DIM}(max blocks/SM allowed by each resource)${R}\n"
  for m in "${LIMITERS[@]}"; do row "$m"; done
  hr
  printf "  ${DIM}ctrl-c to stop${R}\n"

  sleep "$INTERVAL"
done
