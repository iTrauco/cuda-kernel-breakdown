import os from 'node:os';
import path from 'node:path';

export const config = {
  port: 8787,
  arch: 'sm_86',
  workDir: path.join(os.tmpdir(), 'cuda-lab'),
  nvcc: 'nvcc',
  // host compiler for nvcc. the backend invokes nvcc via execFile, which does not
  // resolve the env's gcc the way an interactive shell does; plain gcc is the system
  // gcc-13 that nvcc rejects. point at the env's prefixed g++ (12.x) explicitly.
  ccbin: '/home/trauco/miniconda3/envs/cuda-kernel-breakdown/bin/x86_64-conda-linux-gnu-g++',
  ncuSudo: true,
  ncu: '/home/trauco/miniconda3/envs/cuda-kernel-breakdown/nsight-compute/2024.1.1/ncu',
  metrics: [
    'gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed',
    'sm__throughput.avg.pct_of_peak_sustained_active',
    'sm__warps_active.avg.pct_of_peak_sustained_active',
    'gpu__time_duration.sum',
  ],
};
