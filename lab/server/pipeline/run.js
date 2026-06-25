import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { parseNcu, detectError, allNull } from './parse.js';

const exec = promisify(execFile);

// compile -> profile -> parse for an arbitrary kernel source and metric set.
// source and metricSet come from the caller (a module's specimen); the runner
// bakes in neither a kernel nor a metric list.
export async function runWorkload(source, metricSet) {
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, stage: 'input', error: 'source must be a non-empty string' };
  }
  if (!Array.isArray(metricSet) || !metricSet.length) {
    return { ok: false, stage: 'input', error: 'metricSet must be a non-empty array' };
  }

  await fs.mkdir(config.workDir, { recursive: true });
  const src = path.join(config.workDir, 'work.cu');
  const bin = path.join(config.workDir, 'work');

  await fs.writeFile(src, source);

  try {
    await exec(config.nvcc, [`-arch=${config.arch}`, '-o', bin, src]);
  } catch (e) {
    return { ok: false, stage: 'compile', error: e.stderr || e.message };
  }

  const ncuArgs = ['--csv', '--metrics', metricSet.join(','), bin];
  const cmd = config.ncuSudo ? 'sudo' : config.ncu;
  const args = config.ncuSudo ? [config.ncu, ...ncuArgs] : ncuArgs;

  let raw = '';
  try {
    const { stdout, stderr } = await exec(cmd, args, { maxBuffer: 1 << 24 });
    raw = stdout + stderr;
  } catch (e) {
    raw = (e.stdout || '') + (e.stderr || '');
  }

  const err = detectError(raw);
  if (err) return { ok: false, stage: 'profile', error: err, raw };

  const metrics = parseNcu(raw, metricSet);
  if (allNull(metrics)) {
    return { ok: false, stage: 'profile', error: 'no_metrics_parsed', raw };
  }

  return { ok: true, metrics, raw };
}
