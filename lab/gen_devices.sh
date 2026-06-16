#!/usr/bin/env bash
# queries real device properties for every gpu on this node, writes json the lab loads.
# run on each node; output lands in lab/src/data/<hostname>.json
set -uo pipefail
cd "$(dirname "$0")"
OUT="src/data/$(hostname).json"
TMP="$(mktemp -d)"

cat > "$TMP/q.cu" <<'CU'
#include <cstdio>
#include <cuda_runtime.h>
int main() {
  int n = 0; cudaGetDeviceCount(&n);
  printf("{\n  \"host\": \"%s\",\n  \"devices\": [\n", getenv("HOSTNAME") ? getenv("HOSTNAME") : "unknown");
  for (int i = 0; i < n; i++) {
    cudaDeviceProp p; cudaGetDeviceProperties(&p, i);
    printf("    {\n");
    printf("      \"index\": %d,\n", i);
    printf("      \"name\": \"%s\",\n", p.name);
    printf("      \"cc\": \"%d.%d\",\n", p.major, p.minor);
    printf("      \"warpSize\": %d,\n", p.warpSize);
    printf("      \"maxThreadsPerSM\": %d,\n", p.maxThreadsPerMultiProcessor);
    printf("      \"maxWarpsPerSM\": %d,\n", p.maxThreadsPerMultiProcessor / p.warpSize);
    printf("      \"maxBlocksPerSM\": %d,\n", p.maxBlocksPerMultiProcessor);
    printf("      \"regsPerSM\": %d,\n", p.regsPerMultiprocessor);
    printf("      \"regsPerBlock\": %d,\n", p.regsPerBlock);
    printf("      \"smemPerSM\": %zu,\n", p.sharedMemPerMultiprocessor);
    printf("      \"smemPerBlock\": %zu,\n", p.sharedMemPerBlock);
    printf("      \"smCount\": %d,\n", p.multiProcessorCount);
    printf("      \"maxThreadsPerBlock\": %d,\n", p.maxThreadsPerBlock);
    printf("      \"regAllocUnit\": 256,\n");
    printf("      \"smemAllocUnit\": 128\n");
    printf("    }%s\n", i + 1 < n ? "," : "");
  }
  printf("  ]\n}\n");
  return 0;
}
CU

nvcc -o "$TMP/q" "$TMP/q.cu" || { echo "nvcc failed"; rm -rf "$TMP"; exit 1; }
HOSTNAME="$(hostname)" "$TMP/q" > "$OUT"
rm -rf "$TMP"
echo "wrote $OUT"
cat "$OUT"
