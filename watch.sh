#!/usr/bin/env bash
cd "$(dirname "$0")"
source ./config.sh
echo "watching ${SRC} ... (ctrl-c to stop)"
ls "$SRC" | entr -c ./_profile.sh
