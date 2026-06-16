#!/usr/bin/env bash
# Single source of truth for the build env. Sourced by all scripts.

# GPU architecture: RTX A4000 = compute capability 8.6
export ARCH="sm_86"

# Paths (relative to repo root)
export SRC="src/kernel.cu"
export BIN="build/kernel"

# nvcc flags (extend here later, e.g. -O3, -lineinfo)
export NVCC_FLAGS="-arch=${ARCH}"

# Profiler command. Using sudo + full path because counters need elevated access
# and ncu lives in the conda env (root PATH can't see it otherwise).
export NCU="sudo $(which ncu)"
