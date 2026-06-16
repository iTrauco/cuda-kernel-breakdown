export function parseNcu(raw, metricNames) {
  const out = {};
  for (const m of metricNames) {
    const line = raw.split('\n').find((l) => l.includes(m));
    if (!line) { out[m] = null; continue; }
    const parts = line.trim().split(/\s+/);
    const val = parts[parts.length - 1];
    out[m] = isNaN(parseFloat(val)) ? val : parseFloat(val);
  }
  return out;
}
export function detectError(raw) {
  if (raw.includes('ERR_NVGPUCTRPERM')) return 'counter_permission';
  if (raw.includes('No kernels were profiled')) return 'no_kernel';
  return null;
}
