# cuda-kernel-breakdown — technical state

Status snapshot of the `cuda-kernel-breakdown` lab as built. This records what
exists, what was measured, and what is explicitly unknown. Values here are
either taken directly from tool output during setup or are configuration as
written in the repo. Where something is a stand-in or unverified, it says so.

## hardware and driver

| item | value | source |
|------|-------|--------|
| gpu | nvidia rtx a4000 | `nvidia-smi -L` |
| compute capability | 8.6 (`sm_86`) | `cudaGetDeviceProperties` via `gen_devices.sh` |
| driver version | 535.309.01 | `nvidia-smi` |
| max cuda supported by driver | 12.2 | driver/cuda compatibility |

Device limits queried live from `cudaGetDeviceProperties` (not assumed):

| limit | value |
|-------|-------|
| sm count | 48 |
| max threads / sm | 1536 |
| max warps / sm | 48 |
| max blocks / sm | 16 |
| registers / sm | 65536 |
| shared mem / sm | 102400 bytes |
| shared mem / block | 49152 bytes |
| warp size | 32 |
| max threads / block | 1024 |

Two values in the device JSON are not exposed by `cudaGetDeviceProperties` and
are set to standard architectural values, not queried: `regAllocUnit` (256) and
`smemAllocUnit` (128).

## toolchain

| tool | version | notes |
|------|---------|-------|
| nvcc | 12.2.2 (release 12.9 was installed first, then downgraded) | downgraded to match driver 535 |
| ncu (nsight compute) | 2025.2.1.0 | |
| conda env | `cuda-kernel-breakdown`, python 3.11 | numpy, pytest, cuda-toolkit |
| node | present (lab backend) | |

The toolkit was initially installed at 12.9, which produced
`cudaErrorUnsupportedPtxVersion (222)` at kernel launch because driver 535 cannot
load 12.9-compiled code. Resolved by downgrading the conda toolkit to 12.2.
All builds target `-arch=sm_86`.

## ncu permission state

`ncu` cannot read gpu performance counters as a normal user on this box; it
returns `ERR_NVGPUCTRPERM`. The durable fix (modprobe
`NVreg_RestrictProfilingToAdminUsers=0` + reboot) was **not** applied. Current
workaround: profiling runs use `sudo` with the full path to `ncu`, because
`sudo` does not inherit the conda env PATH. This is baked into the lab backend
config (`ncuSudo: true`, `ncu` set to the absolute path).

## repository layout

```
cuda-kernel-breakdown/
├── config.sh            single source of build config (arch, paths, ncu cmd)
├── _profile.sh          shared build + ncu profile + colored metric render
├── run.sh               one-shot profile (wraps _profile.sh)
├── watch.sh             rebuild + reprofile on save via entr
├── observe.sh           standalone timer-based gpu + kernel monitor
├── occupancy.sh         launch geometry, resources, occupancy, limiters
├── dash.sh              live moving dashboard (telemetry bars, sparklines, profile)
├── environment.yml      conda env export (--from-history)
├── src/
│   └── kernel.cu        copy-kernel baseline + host harness
└── lab/                 browser tool (vite vanilla js frontend + node backend)
    ├── gen_devices.sh   queries real device props -> src/data/<hostname>.json
    ├── index.html
    ├── server/          node backend (compiles + profiles on request)
    │   ├── index.js     http server, routes /run
    │   ├── config.js    port, arch, ncu path, metrics
    │   ├── kernel/template.js   knobs -> .cu source (pure)
    │   ├── pipeline/run.js      write -> nvcc -> ncu -> parse (io)
    │   ├── pipeline/parse.js    ncu text -> metric values (pure)
    │   └── routes/run.js        request body -> pipeline -> json
    └── src/
        ├── main.js              wires occupancy lab to dom
        ├── lib/occupancy.js     pure sm_86 occupancy math
        ├── data/devices.js      loads per-node device json
        ├── data/<hostname>.json generated device limits
        ├── components/workloadRunner.js  workload ui + backend call + results
        └── styles.css
```

## git state

- branch `develop` set as the working/main branch at init.
- `dram-throughput` branch held the profiling/observability scripts; merged into
  `develop` via pull request.
- `lab-occupancy-explorer` branch holds the browser lab; pushed to origin.

## scripts — what each does

- `config.sh` — exports `ARCH=sm_86`, `SRC`, `BIN`, `NVCC_FLAGS`, and `NCU`
  (set to `sudo <full path to ncu>`). Single source of truth sourced by the
  other scripts.
- `_profile.sh` — builds with `nvcc $NVCC_FLAGS`, runs `ncu` for a fixed metric
  set, renders a colored table, copies raw output to clipboard. Detects
  `ERR_NVGPUCTRPERM` and "no kernels profiled".
- `run.sh` — one-shot wrapper that execs `_profile.sh`.
- `watch.sh` — `entr` watches `src/kernel.cu`; reruns `_profile.sh` on save.
- `observe.sh` — timer loop; nvidia-smi telemetry plus periodic kernel profile.
- `occupancy.sh` — timer loop focused on launch geometry, per-thread resources,
  achieved occupancy, and per-resource occupancy limiters.
- `dash.sh` — dense live dashboard: telemetry bars (util/mem/power/temp/fan/
  clocks), sparkline history, and a periodic kernel profile with a warp-slot
  grid. Telemetry refreshes every tick; profile every 5 ticks.

## lab — how it works

The occupancy half runs entirely in the browser: `lib/occupancy.js` computes,
for a given block size / registers / shared-mem and a selected device, how many
blocks fit per sm, which resource binds, and the resulting occupancy. This is a
closed-form calculation against the real per-node device limits loaded from
generated JSON. No gpu access needed.

The workload half requires the node backend, because a browser cannot compile
or profile. On "run on gpu", the frontend POSTs knobs to `localhost:8787/run`.
The backend templates a `.cu` file, compiles it with `nvcc -arch=sm_86`, runs it
under `sudo ncu`, parses the metrics, and returns them. Each run logs a row.

Two servers must run concurrently: vite (frontend, port 5173) and the node
backend (port 8787). The backend must be started from a shell with the conda env
active so `nvcc` is on PATH.

### workload knobs

- **mode** — access pattern. `streaming` = consecutive threads read consecutive
  addresses (coalesced). `strided` = threads read `stride` elements apart
  (uncoalesced).
- **stride** — gap size between thread accesses, only meaningful in strided mode.
- **access width** — bytes per thread per load: `float` (4B), `float2` (8B),
  `float4` (16B).
- **elements** — total workload size.
- **block size** — threads per block.

The workload kernels are saxpy-style (`out[i] = a*x[i] + y[i]`), chosen as
representative memory-bound streaming workloads. They are **not** a
reconstruction of the original assessment kernel (see gaps).

## measured values

### original assessment kernel (from provided nsight metrics, not re-run)

| metric | value |
|--------|-------|
| dram throughput | 12.25 % |
| l1/tex throughput | 11.28 % |
| l2 throughput | 12.00 % |
| compute (sm) throughput | 13.43 % |
| registers / thread | 32 |
| theoretical occupancy | 100 % |
| achieved occupancy | 10.50 % |

Reading: all throughputs are uniformly low while theoretical occupancy is 100%
and achieved is 10.5%. This is consistent with a device that is under-fed
(insufficient concurrent work), not one bottlenecked on memory or compute. The
binding problem points at achieved occupancy, not access pattern.

### lab workload, measured on this a4000 via the backend

| config | dram throughput | duration | sm throughput |
|--------|-----------------|----------|---------------|
| streaming, float, n=1048576, block=256 | 85.37 % | 41.34 µs | 25.53 % |

This is the only workload run captured in this snapshot. The comparison runs
(strided, float4, starved) are the intended next experiments and were not yet
recorded here.

Note: the backend returned `sm__warps_active.avg.pct_of_peak_sustained_active`
as `104.00` for this run. Occupancy cannot exceed 100%; this is an ncu
metric/parse oddity flagged for follow-up. The frontend clamps the displayed
value. It does not affect the dram throughput figure.

## known gaps and honest limits

1. **Original kernel is not runnable as given.** The provided source references
   `device_func(...)` and `b_val`, neither of which is defined anywhere
   supplied. The substantive per-element logic therefore cannot be profiled or
   reconstructed. The lab workloads are representative stand-ins, not the
   original.

2. **DRAM throughput is measured, not modeled.** There is no browser-side
   formula that predicts dram throughput from parameters. The lab's occupancy
   numbers are calculated; the dram numbers come only from running the kernel
   under ncu.

3. **ncu permission is a workaround, not a fix.** Profiling depends on `sudo`.
   A reboot with the modprobe setting would remove that dependency.

4. **Occupancy 104% artifact** in the backend metric parse is unresolved.

5. **The assessment prompt itself has not been recorded here.** This document
   describes the tooling and observations; it does not assert that the tooling
   is sufficient to answer the assessment, because the exact question was not
   captured.

## suggested next steps

- Run the lab comparison sweep: streaming vs strided (stride 8), and float vs
  float4, to record how access pattern and access width move measured dram
  throughput against the 85.37% baseline.
- For any recommendation tied to the original kernel's 10.5% achieved
  occupancy, use `occupancy.sh` / the occupancy lab to reason about launch
  configuration, since occupancy (not coalescing) is what its metrics implicate.
- Resolve the occupancy 104% parse before citing occupancy numbers from the
  backend.