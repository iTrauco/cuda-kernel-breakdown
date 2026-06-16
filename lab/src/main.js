import { createWorkloadRunner } from './components/workloadRunner.js';
import './styles.css';
import { loadDevices, deviceLabel } from './data/devices.js';
import { computeOccupancy } from './lib/occupancy.js';

const devices = loadDevices();
const app = document.querySelector('#app');

const state = {
  deviceIdx: 0,
  blockSize: 256,
  regsPerThread: 32,
  sharedPerBlock: 0,
};

function dev() {
  return devices[state.deviceIdx];
}

function render() {
  if (!devices.length) {
    app.innerHTML = `<p class="warn">no device json found. run ./gen_devices.sh on this node.</p>`;
    return;
  }
  const d = dev();
  const r = computeOccupancy(
    { blockSize: state.blockSize, regsPerThread: state.regsPerThread, sharedPerBlock: state.sharedPerBlock },
    d
  );

  app.innerHTML = `
    <h1>occupancy lab</h1>

    <label class="field">
      <span>device</span>
      <select id="device">
        ${devices.map((x, i) => `<option value="${i}" ${i === state.deviceIdx ? 'selected' : ''}>${deviceLabel(x)}</option>`).join('')}
      </select>
    </label>

    ${slider('blockSize', 'block size (threads)', 32, d.maxThreadsPerBlock, 32, state.blockSize)}
    ${slider('regsPerThread', 'registers / thread', 0, 255, 1, state.regsPerThread)}
    ${slider('sharedPerBlock', 'shared mem / block (bytes)', 0, d.smemPerBlock, 256, state.sharedPerBlock)}

    <div class="readout">
      <div class="big ${r.occupancyPct < 33 ? 'low' : r.occupancyPct < 66 ? 'mid' : 'high'}">
        ${r.occupancyPct}<span class="unit">% occupancy</span>
      </div>
      <div class="sub">${r.activeWarpsPerSM} / ${r.maxWarpsPerSM} warps active per sm</div>
    </div>

    <div class="grid" id="warps"></div>

    <div class="limiter">
      limited by: <strong>${r.limiter}</strong>
      <div class="caps">
        ${Object.entries(r.caps).map(([k, v]) =>
          `<span class="${k === r.limiter ? 'bind' : ''}">${k}: ${v === Infinity ? '∞' : v}</span>`
        ).join('')}
      </div>
      <div class="sub">active blocks/sm: ${r.activeBlocksPerSM} · warps/block: ${r.warpsPerBlock}</div>
    </div>
  `;

  drawWarps(r);
  wire();
}

function slider(id, label, min, max, step, val) {
  return `
    <label class="field">
      <span>${label}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" />
      <output>${val}</output>
    </label>`;
}

function drawWarps(r) {
  const wrap = document.querySelector('#warps');
  const max = r.maxWarpsPerSM;
  let html = '';
  for (let i = 0; i < max; i++) {
    html += `<span class="cell ${i < r.activeWarpsPerSM ? 'on' : ''}"></span>`;
  }
  wrap.innerHTML = html;
}

function wire() {
  document.querySelector('#device').addEventListener('change', (e) => {
    state.deviceIdx = +e.target.value;
    state.blockSize = Math.min(state.blockSize, dev().maxThreadsPerBlock);
    render();
document.querySelector('#app').appendChild(createWorkloadRunner());
  });
  for (const id of ['blockSize', 'regsPerThread', 'sharedPerBlock']) {
    const el = document.querySelector('#' + id);
    if (!el) continue;
    el.addEventListener('input', (e) => {
      state[id] = +e.target.value;
      render();
    });
  }
}

render();
document.querySelector('#runner-root').appendChild(createWorkloadRunner());
