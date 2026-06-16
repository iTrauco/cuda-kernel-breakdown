import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { buildKernel } from '../kernel/template.js';
import { parseNcu, detectError } from './parse.js';

const exec = promisify(execFile);

export async function runWorkload(knobs) {
  await fs.mkdir(config.workDir, { recursive: true });
  const src = path.join(config.workDir, 'work.cu');
  const bin = path.join(config.workDir, 'work');

  await fs.writeFile(src, buildKernel(knobs));

  try {
    await exec(config.nvcc, [`-arch=${config.arch}`, '-o', bin, src]);
  } catch (e) {
    return { ok: false, stage: 'compile', error: e.stderr || e.message };
  }

  const ncuArgs = ['--metrics', config.metrics.join(','), bin];
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

  return { ok: true, knobs, metrics: parseNcu(raw, config.metrics), raw };
}
