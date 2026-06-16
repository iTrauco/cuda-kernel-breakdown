#!/usr/bin/env bash
# Build + profile + render one pass. Sourced config, called by watch.sh and run.sh.
cd "$(dirname "$0")"
source ./config.sh

# ---- colors --------------------------------------------------
R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'
BLU=$'\033[34m'; CYN=$'\033[36m'; MAG=$'\033[35m'

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

clear
printf "${B}${CYN}  CUDA KERNEL BREAKDOWN${R}  ${DIM}live profiler${R}\n"
printf "  ${DIM}branch:${R} ${MAG}%s${R}   ${DIM}arch:${R} ${MAG}%s${R}   ${DIM}%s${R}\n" \
  "$(git branch --show-current 2>/dev/null || echo '?')" "$ARCH" "$(date '+%Y-%m-%d %H:%M:%S')"
hr

# ---- build ----
printf "  ${B}BUILD${R}  "
if ! err=$(nvcc ${NVCC_FLAGS} -o "$BIN" "$SRC" 2>&1); then
  printf "${RED}FAILED${R}\n"; hr; printf "%s\n" "$err"; exit 1
fi
printf "${GRN}ok${R}  ${DIM}(%s)${R}\n" "$NVCC_FLAGS"

# ---- profile ----
printf "  ${B}PROFILE${R}\n"; hr
raw=$($NCU --metrics "$METRICS" "./$BIN" 2>&1)

if echo "$raw" | grep -q "ERR_NVGPUCTRPERM"; then
  printf "${RED}  ncu lacks counter permissions (ERR_NVGPUCTRPERM)${R}\n"; echo "$raw"; exit 1
fi
if echo "$raw" | grep -q "No kernels were profiled"; then
  printf "${RED}  no kernels profiled (launch failed?)${R}\n"; echo "$raw"; exit 1
fi

# ---- render ----
printf "  ${B}%-26s %12s${R}\n" "METRIC" "VALUE"; hr
for m in "${ORDER[@]}"; do
  line=$(echo "$raw" | grep -m1 -F "$m")
  val=$(echo "$line" | awk '{print $NF}')
  [ -z "$val" ] && val="-"
  printf "  %-26s ${BLU}%12s${R}\n" "${LABEL[$m]}" "$val"
done
hr
printf "  ${DIM}copied to clipboard  -  edit %s to re-run${R}\n" "$SRC"
echo "$raw" | xclip -selection clipboard 2>/dev/null
