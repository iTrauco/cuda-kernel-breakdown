// parse ncu --csv output. ncu emits ==PROF== preamble lines, then a quoted header
// row, then one quoted row per metric. we key on the "Metric Name" column and read
// "Metric Value", so parsing never depends on token position or table column width.
// values may carry a thousands separator inside the quotes (e.g. "39,808"), so the
// splitter is quote-aware and separators are stripped before parseFloat.

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function toNumber(raw) {
  const cleaned = raw.replace(/,/g, ''); // drop thousands separators
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? raw : n;
}

export function parseNcu(raw, metricNames) {
  const out = {};
  for (const m of metricNames) out[m] = null;

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => l.includes('"Metric Name"') && l.includes('"Metric Value"'));
  if (headerIdx === -1) return out;

  const header = splitCsvLine(lines[headerIdx]).map((c) => c.replace(/^"|"$/g, ''));
  const nameCol = header.indexOf('Metric Name');
  const valCol = header.indexOf('Metric Value');
  if (nameCol === -1 || valCol === -1) return out;

  const wanted = new Set(metricNames);
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]).map((c) => c.replace(/^"|"$/g, ''));
    const name = cells[nameCol];
    if (wanted.has(name)) out[name] = toNumber(cells[valCol]);
  }
  return out;
}

export function detectError(raw) {
  if (raw.includes('ERR_NVGPUCTRPERM')) return 'counter_permission';
  if (raw.includes('No kernels were profiled')) return 'no_kernel';
  if (raw.includes('nsight-compute directory is not found')) return 'ncu_install_not_found';
  return null;
}

// a successful profile yields at least one non-null metric. an all-null result means
// the profiler ran but produced nothing parseable (or silently failed) and must not
// be reported as ok. used by the runner to reject false-positive successes.
export function allNull(metrics) {
  return Object.values(metrics).every((v) => v == null);
}
