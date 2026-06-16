#!/usr/bin/env bash
# Live GPU dashboard. Dense + moving. Usage: ./dash.sh [interval]  (default 1)
cd "$(dirname "$0")"
source ./config.sh
INTERVAL="${1:-1}"

R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[34m'
CYN=$'\033[36m'; MAG=$'\033[35m'; WHT=$'\033[37m'

SPARKS=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █)
declare -a HIST_UTIL HIST_MEM HIST_TEMP
PROFILE_EVERY=5   # re-profile kernel every N ticks (ncu is heavy)
tick=0
RAW=""

# color by value: green low->red high (for temp/util load)
heat() { local v=${1%.*}; [[ "$v" =~ ^[0-9]+$ ]] || { printf "%s" "$DIM"; return; }
  if [ "$v" -lt 33 ]; then printf "%s" "$GRN"
  elif [ "$v" -lt 66 ]; then printf "%s" "$YEL"; else printf "%s" "$RED"; fi; }

# horizontal bar: bar <value 0-100> <width> <color>
bar() {
  local v=${1%.*}; local w=$2; local c=$3
  [[ "$v" =~ ^[0-9]+$ ]] || v=0
  [ "$v" -gt 100 ] && v=100
  local fill=$(( v * w / 100 ))
  local i; printf "%s" "$c"
  for ((i=0;i<fill;i++)); do printf "█"; done
  printf "${DIM}"
  for ((i=fill;i<w;i++)); do printf "░"; done
  printf "${R}"
}

# sparkline from an array name
spark() {
  local -n arr=$1; local s=""
  for v in "${arr[@]}"; do
    local idx=$(( ${v%.*} * 7 / 100 )); [ "$idx" -lt 0 ] && idx=0; [ "$idx" -gt 7 ] && idx=7
    s+="${SPARKS[$idx]}"
  done
  printf "%s" "$s"
}

push() { local -n a=$1; a+=("$2"); [ "${#a[@]}" -gt 40 ] && a=("${a[@]:1}"); }
hr() { printf "${DIM}%s${R}\n" "════════════════════════════════════════════════════════════"; }

val_of() { echo "$RAW" | grep -m1 -F "$1" | awk '{print $NF}'; }

while true; do
  # ---- live telemetry (cheap, every tick) ----
  read GUTIL MUTIL MUSED MTOTAL TEMP PWR PMAX FAN SMCLK MEMCLK < <(
    nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,clocks.mem \
      --format=csv,noheader,nounits 2>/dev/null | tr ',' ' ')
  GUTIL=${GUTIL:-0}; MUTIL=${MUTIL:-0}; TEMP=${TEMP:-0}; FAN=${FAN:-0}
  MUSED=${MUSED:-0}; MTOTAL=${MTOTAL:-1}; PWR=${PWR:-0}; PMAX=${PMAX:-1}
  mempct=$(( ${MUSED%.*} * 100 / ${MTOTAL%.*} ))
  pwrpct=$(( ${PWR%.*} * 100 / ${PMAX%.*} ))

  push HIST_UTIL "$GUTIL"; push HIST_MEM "$mempct"; push HIST_TEMP "$TEMP"

  # ---- profile (heavy, every PROFILE_EVERY ticks) ----
  if [ $(( tick % PROFILE_EVERY )) -eq 0 ] && [ -x "./$BIN" ]; then
    RAW=$($NCU --metrics gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed,l1tex__throughput.avg.pct_of_peak_sustained_active,lts__throughput.avg.pct_of_peak_sustained_active,sm__throughput.avg.pct_of_peak_sustained_active,sm__warps_active.avg.pct_of_peak_sustained_active,launch__registers_per_thread,launch__block_size,launch__grid_size "./$BIN" 2>&1)
  fi

  clear
  printf "${B}${CYN} ▄ CUDA LIVE DASH ▄${R}  ${DIM}%s   tick %d   refresh %ss${R}\n" "$(date '+%H:%M:%S')" "$tick" "$INTERVAL"
  printf " ${DIM}branch ${MAG}%s${DIM}  arch ${MAG}%s${R}\n" "$(git branch --show-current 2>/dev/null||echo '?')" "$ARCH"
  hr

  printf "${B} LIVE GPU${R}\n"
  hc=$(heat $GUTIL); printf "  GPU Util  %s ${hc}%3s%%${R}\n" "$(bar $GUTIL 30 "$hc")" "$GUTIL"
  printf "  Mem Used  %s ${BLU}%3s%%${R} ${DIM}%s/%s MiB${R}\n" "$(bar $mempct 30 "$BLU")" "$mempct" "$MUSED" "$MTOTAL"
  printf "  Mem I/O   %s ${MAG}%3s%%${R}\n" "$(bar $MUTIL 30 "$MAG")" "$MUTIL"
  printf "  Power     %s ${YEL}%3s%%${R} ${DIM}%s/%s W${R}\n" "$(bar $pwrpct 30 "$YEL")" "$pwrpct" "$PWR" "$PMAX"
  tc=$(heat $TEMP); printf "  Temp      %s ${tc}%3s C${R}   ${DIM}fan ${R}%s%%\n" "$(bar $TEMP 30 "$tc")" "$TEMP" "$FAN"
  printf "  Clocks    ${DIM}sm${R} ${CYN}%s${R} ${DIM}MHz   mem${R} ${CYN}%s${R} ${DIM}MHz${R}\n" "$SMCLK" "$MEMCLK"
  hr

  printf "${B} HISTORY${R} ${DIM}(last %d ticks)${R}\n" "${#HIST_UTIL[@]}"
  printf "  util ${GRN}%s${R}\n" "$(spark HIST_UTIL)"
  printf "  mem  ${BLU}%s${R}\n" "$(spark HIST_MEM)"
  printf "  temp ${RED}%s${R}\n" "$(spark HIST_TEMP)"
  hr

  printf "${B} KERNEL PROFILE${R} ${DIM}(every %d ticks)${R}\n" "$PROFILE_EVERY"
  if echo "$RAW" | grep -q "ERR_NVGPUCTRPERM"; then
    printf "  ${RED}counter permission denied${R}\n"
  elif [ -z "$RAW" ]; then
    printf "  ${DIM}waiting for first profile...${R}\n"
  else
    dram=$(val_of gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed)
    l1=$(val_of l1tex__throughput.avg.pct_of_peak_sustained_active)
    l2=$(val_of lts__throughput.avg.pct_of_peak_sustained_active)
    sm=$(val_of sm__throughput.avg.pct_of_peak_sustained_active)
    occ=$(val_of sm__warps_active.avg.pct_of_peak_sustained_active)
    regs=$(val_of launch__registers_per_thread)
    bs=$(val_of launch__block_size); gs=$(val_of launch__grid_size)
    printf "  DRAM      %s ${CYN}%6s%%${R}\n" "$(bar $dram 30 "$CYN")" "$dram"
    printf "  L1/TEX    %s ${CYN}%6s%%${R}\n" "$(bar $l1 30 "$CYN")" "$l1"
    printf "  L2        %s ${CYN}%6s%%${R}\n" "$(bar $l2 30 "$CYN")" "$l2"
    printf "  Compute   %s ${CYN}%6s%%${R}\n" "$(bar $sm 30 "$CYN")" "$sm"
    oc=$(heat $occ); printf "  Occupancy %s ${oc}%6s%%${R}\n" "$(bar $occ 30 "$oc")" "$occ"
    # warp-slot grid: draw occupancy as filled cells out of 48 (sm_86 max warps/SM)
    if [[ "${occ%.*}" =~ ^[0-9]+$ ]]; then
      filled=$(( ${occ%.*} * 48 / 100 ))
      printf "  warps/SM  "
      for ((i=0;i<48;i++)); do
        if [ "$i" -lt "$filled" ]; then printf "${GRN}▰${R}"; else printf "${DIM}▱${R}"; fi
        [ $(( (i+1) % 16 )) -eq 0 ] && [ "$i" -lt 47 ] && printf "\n            "
      done
      printf "  ${DIM}(%s/48)${R}\n" "$filled"
    fi
    printf "  ${DIM}launch: grid ${R}%s${DIM} blocks x block ${R}%s${DIM} threads, ${R}%s${DIM} regs/thread${R}\n" "$gs" "$bs" "$regs"
  fi
  hr
  printf " ${DIM}ctrl-c to stop${R}\n"

  tick=$((tick+1))
  sleep "$INTERVAL"
done
