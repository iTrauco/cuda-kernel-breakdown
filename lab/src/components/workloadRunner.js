// workload runner: knobs -> POST backend -> real measured metrics -> results log.
// pure-ish: owns its own dom node and state, exposes create().

const BACKEND = 'http://localhost:8787/run';
const DRAM = 'gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed';
const SM = 'sm__throughput.avg.pct_of_peak_sustained_active';
const OCC = 'sm__warps_active.avg.pct_of_peak_sustained_active';
const DUR = 'gpu__time_duration.sum';

const clampPct = (v) => (v == null ? '-' : Math.min(100, Math.round(v * 10) / 10));

export function createWorkloadRunner() {
  const el = document.createElement('div');
  el.className = 'runner';
  const runs = [];

  const state = { mode: 'streaming', n: 1048576, stride: 8, block: 256, vecWidth: 1 };

  function rows() {
    if (!runs.length) return `<tr><td colspan="7" class="muted">no runs yet</td></tr>`;
    return runs.map((r, i) => `
      <tr>
        <td>${runs.length - i}</td>
        <td>${r.knobs.mode}</td>
        <td>${r.knobs.n}</td>
        <td>${r.knobs.mode === 'strided' ? r.knobs.stride : '-'}</td>
        <td>f${r.knobs.vecWidth}</td>
        <td class="num">${clampPct(r.metrics[DRAM])}</td>
        <td class="num">${r.metrics[DUR] == null ? '-' : Math.round(r.metrics[DUR] * 100) / 100}</td>
      </tr>`).join('');
  }

  function render() {
    el.innerHTML = `
      <h2>workload runner <span class="muted">(real gpu)</span></h2>
      <label class="field"><span>mode</span>
        <select id="mode">
          <option value="streaming" ${state.mode==='streaming'?'selected':''}>streaming (coalesced)</option>
          <option value="strided" ${state.mode==='strided'?'selected':''}>strided (uncoalesced)</option>
        </select><output></output></label>
      <label class="field"><span>access width</span>
        <select id="vecWidth">
          <option value="1" ${state.vecWidth==1?'selected':''}>float</option>
          <option value="2" ${state.vecWidth==2?'selected':''}>float2</option>
          <option value="4" ${state.vecWidth==4?'selected':''}>float4</option>
        </select><output></output></label>
      <label class="field"><span>elements</span>
        <input type="number" id="n" value="${state.n}" step="65536" min="1024" /><output></output></label>
      <label class="field"><span>stride</span>
        <input type="number" id="stride" value="${state.stride}" min="1" ${state.mode==='strided'?'':'disabled'} /><output></output></label>
      <label class="field"><span>block size</span>
        <input type="number" id="block" value="${state.block}" step="32" min="32" max="1024" /><output></output></label>
      <button id="run">run on gpu</button>
      <span id="status" class="muted"></span>
      <table class="results">
        <thead><tr><th>#</th><th>mode</th><th>elements</th><th>stride</th><th>width</th><th>dram %</th><th>µs</th></tr></thead>
        <tbody>${rows()}</tbody>
      </table>`;
    wire();
  }

  function wire() {
    for (const id of ['mode','vecWidth','n','stride','block']) {
      const node = el.querySelector('#'+id);
      node.addEventListener('change', (e) => {
        state[id] = id==='mode' ? e.target.value : (id==='vecWidth'||id==='n'||id==='stride'||id==='block') ? +e.target.value : e.target.value;
        if (id==='mode') render();
      });
    }
    el.querySelector('#run').addEventListener('click', run);
  }

  async function run() {
    const status = el.querySelector('#status');
    const btn = el.querySelector('#run');
    btn.disabled = true; status.textContent = 'compiling + profiling...';
    try {
      const res = await fetch(BACKEND, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      const data = await res.json();
      if (!data.ok) { status.textContent = 'error: ' + (data.error || data.stage); }
      else { runs.unshift(data); status.textContent = `dram ${clampPct(data.metrics[DRAM])}%`; }
    } catch (e) {
      status.textContent = 'backend unreachable (is node server running on 8787?)';
    }
    btn.disabled = false;
    render();
  }

  render();
  return el;
}
