// occupancy module: predict-only. wraps the existing pure occupancy math behind the
// module interface. no specimen, no metrics — the why is computed offline.
import { computeOccupancy } from '../lib/occupancy.js';

export const occupancy = {
  id: 'occupancy',
  label: 'occupancy',

  knobs: [
    { name: 'blockSize',      label: 'block size (threads)',       type: 'range', min: 32, max: 'maxThreadsPerBlock', step: 32,  default: 256 },
    { name: 'regsPerThread',  label: 'registers / thread',         type: 'range', min: 0,  max: 255,                 step: 1,   default: 32  },
    { name: 'sharedPerBlock', label: 'shared mem / block (bytes)', type: 'range', min: 0,  max: 'smemPerBlock',      step: 256, default: 0   },
  ],

  // pure, offline, no GPU. device is the limits object.
  predict(knobs, device) {
    return computeOccupancy(
      { blockSize: knobs.blockSize, regsPerThread: knobs.regsPerThread, sharedPerBlock: knobs.sharedPerBlock },
      device
    );
  },

  // inert for now; present so a later persistence pass is cheap.
  getKnobs() { return null; },
  setKnobs(_values) {},

  // renders predicted alone; measured is null for a predict-only module.
  view(predicted, _measured) {
    const r = predicted;
    const el = document.createElement('div');
    el.innerHTML = `
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
          ${Object.entries(r.caps).map(([k, v]) => `<span class="${k === r.limiter ? 'bind' : ''}">${k}: ${v === Infinity ? '∞' : v}</span>`).join('')}
        </div>
        <div class="sub">active blocks/sm: ${r.activeBlocksPerSM} · warps/block: ${r.warpsPerBlock}</div>
      </div>
    `;
    const wrap = el.querySelector('#warps');
    let html = '';
    for (let i = 0; i < r.maxWarpsPerSM; i++) html += `<span class="cell ${i < r.activeWarpsPerSM ? 'on' : ''}"></span>`;
    wrap.innerHTML = html;
    return el;
  },
};
