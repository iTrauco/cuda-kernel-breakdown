// step-2 verification: feed the PARKED saxpy through the refactored runner's new
// source + metricSet signature and confirm it still produces metrics on the A4000.
// not part of the app; a one-shot check. run with the conda env active:
//   node lab/server/verify-runner.js
// sudo ncu will prompt for a password. config.metrics is imported here to supply the
// saxpy's metric set; the runner itself no longer references it.
import { buildKernel } from './kernel/template.js';
import { config } from './config.js';
import { runWorkload } from './pipeline/run.js';

const source = buildKernel({ mode: 'streaming', n: 1 << 20, block: 256, vecWidth: 1 });
const result = await runWorkload(source, config.metrics);

console.log('ok:', result.ok, '| stage:', result.stage ?? '-');
if (result.ok) {
  console.log('metrics:');
  for (const m of config.metrics) console.log('  ', m, '=', result.metrics[m]);
} else {
  console.log('error:', result.error);
  if (result.raw) console.log('--- raw ---\n' + result.raw);
}
process.exit(result.ok ? 0 : 1);
