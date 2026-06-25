// generic module loader. names no concept. owns device-picker chrome + module picker,
// builds controls from each module's declared knobs, calls predict (always, offline),
// and — for a module with a specimen — profiles on the gpu only on explicit request,
// then calls view. any module exposing the interface runs here without changing this file.
import { loadDevices, deviceLabel } from '../data/devices.js';

const BACKEND = 'http://localhost:8787/run';

// bound resolver: a knob bound is a literal number OR a single device-limit key the
// loader looks up on the device object and substitutes. no expressions, no arithmetic.
// a module needing a derived bound clamps inside its own predict, not here.
function resolveBound(b, device) {
  if (typeof b === 'number') return b;
  if (typeof b === 'string') {
    const v = device[b];
    if (typeof v !== 'number') throw new Error(`knob bound "${b}" is not a numeric device-limit key`);
    return v;
  }
  throw new Error('knob bound must be a literal number or a single device-limit key');
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createLoader({ modules, mount }) {
  if (!modules || !modules.length) { mount.innerHTML = `<p class="warn">no modules registered.</p>`; return; }
  const devices = loadDevices();
  if (!devices.length) { mount.innerHTML = `<p class="warn">no device json found. run ./gen_devices.sh on this node.</p>`; return; }

  const state = {
    deviceIdx: 0,
    moduleId: modules[0].id,
    // per-module knob values, seeded from declared defaults
    knobs: Object.fromEntries(modules.map((m) => [m.id, Object.fromEntries(m.knobs.map((k) => [k.name, k.default]))])),
    // per-module latest measurement (runner result obj) or null
    measured: Object.fromEntries(modules.map((m) => [m.id, null])),
  };

  const device = () => devices[state.deviceIdx];
  const activeModule = () => modules.find((m) => m.id === state.moduleId);

  // a module with a specimen profiles on the gpu; that runs only on explicit request,
  // never on a knob tick. generate source + metric set from the module and post to the
  // runner. returns the runner's result object ({ ok, metrics, ... }).
  async function runSpecimen(mod, knobs) {
    const source = mod.specimen.generate(knobs);
    const metricSet = mod.specimen.metrics;
    const res = await fetch(BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, metricSet }),
    });
    return res.json();
  }

  function controls(mod, dev) {
    const vals = state.knobs[mod.id];
    return mod.knobs.map((k) => {
      if (k.type === 'range') {
        const min = resolveBound(k.min, dev);
        const max = resolveBound(k.max, dev);
        const v = clamp(vals[k.name], min, max);
        vals[k.name] = v; // write back the clamp (handles device switch shrinking max)
        return `<label class="field"><span>${k.label ?? k.name}</span>
          <input type="range" name="${k.name}" min="${min}" max="${max}" step="${k.step ?? 1}" value="${v}" />
          <output>${v}</output></label>`;
      }
      if (k.type === 'select') {
        const opts = k.options.map((o) => {
          const ov = typeof o === 'string' ? o : o.value;
          const ol = typeof o === 'string' ? o : (o.label ?? o.value);
          return `<option value="${ov}" ${ov === vals[k.name] ? 'selected' : ''}>${ol}</option>`;
        }).join('');
        return `<label class="field"><span>${k.label ?? k.name}</span>
          <select name="${k.name}">${opts}</select></label>`;
      }
      throw new Error(`unknown knob type "${k.type}" in module "${mod.id}"`);
    }).join('');
  }

  function render() {
    const dev = device();
    const mod = activeModule();
    const hasSpecimen = !!mod.specimen;
    mount.innerHTML = `
      <h1>cuda lab</h1>
      <label class="field"><span>device</span>
        <select id="__device">
          ${devices.map((x, i) => `<option value="${i}" ${i === state.deviceIdx ? 'selected' : ''}>${deviceLabel(x)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>module</span>
        <select id="__module">
          ${modules.map((m) => `<option value="${m.id}" ${m.id === state.moduleId ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </label>
      <div id="__controls">${controls(mod, dev)}</div>
      ${hasSpecimen ? `<div class="runbar"><button id="__run">run on gpu</button> <span id="__status" class="muted"></span></div>` : ''}
      <div id="__view"></div>
    `;
    renderView();
    wire();
  }

  // always cheap: predict is offline. shows the latest measurement if one is held.
  function renderView() {
    const dev = device();
    const mod = activeModule();
    const predicted = mod.predict(state.knobs[mod.id], dev);
    const measured = state.measured[mod.id];
    const view = mount.querySelector('#__view');
    view.innerHTML = '';
    view.appendChild(mod.view(predicted, measured));
  }

  async function measure() {
    const mod = activeModule();
    const btn = mount.querySelector('#__run');
    const status = mount.querySelector('#__status');
    btn.disabled = true;
    status.textContent = 'compiling + profiling...';
    try {
      const result = await runSpecimen(mod, state.knobs[mod.id]);
      state.measured[mod.id] = result;
      status.textContent = result.ok ? 'measured' : `error: ${result.error || result.stage}`;
    } catch (e) {
      state.measured[mod.id] = { ok: false, stage: 'transport', error: 'backend unreachable (is the node server on 8787?)' };
      status.textContent = 'backend unreachable';
    }
    btn.disabled = false;
    renderView();
  }

  function wire() {
    mount.querySelector('#__device').addEventListener('change', (e) => {
      state.deviceIdx = +e.target.value;
      state.measured[state.moduleId] = null; // measurement no longer matches device
      render();
    });
    mount.querySelector('#__module').addEventListener('change', (e) => {
      state.moduleId = e.target.value;
      render();
    });
    const runBtn = mount.querySelector('#__run');
    if (runBtn) runBtn.addEventListener('click', measure);

    const mod = activeModule();
    const vals = state.knobs[mod.id];
    for (const k of mod.knobs) {
      const node = mount.querySelector(`[name="${k.name}"]`);
      if (!node) continue;
      const evt = k.type === 'range' ? 'input' : 'change';
      node.addEventListener(evt, (e) => {
        vals[k.name] = k.type === 'range' ? +e.target.value : e.target.value;
        const out = node.parentElement.querySelector('output');
        if (out) out.textContent = vals[k.name];
        state.measured[mod.id] = null; // predicted updates live; a held measurement is now stale
        const s = mount.querySelector('#__status');
        if (s) s.textContent = '';
        if (k.type === 'select') render(); // a select can change which controls/run target apply
        else renderView();
      });
    }
  }

  render();
}
