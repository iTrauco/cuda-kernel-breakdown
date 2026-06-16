import os from 'node:os';
import path from 'node:path';

export const config = {
  port: 8787,
  arch: 'sm_86',
  workDir: path.join(os.tmpdir(), 'cuda-lab'),
  nvcc: 'nvcc',
  ncuSudo: true,
  ncu: '/home/trauco/miniconda3/envs/cuda-kernel-breakdown/bin/ncu',
  metrics: [
    'gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed',
    'sm__throughput.avg.pct_of_peak_sustained_active',
    'sm__warps_active.avg.pct_of_peak_sustained_active',
    'gpu__time_duration.sum',
  ],
};
