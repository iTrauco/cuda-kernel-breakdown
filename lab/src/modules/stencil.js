// stencil module: a 2D filter over an image, three strategies. predict emits the
// concept's quantitative core — global loads per output pixel per strategy — offline.
// specimen generates the selected strategy's kernel for the runner to profile. view
// lays the predicted model beside the measured counters; it draws no conclusion.
import { computeOccupancy } from '../lib/occupancy.js'; // not used; kept paths independent

export const stencil = {
  id: 'stencil',
  label: 'stencil',

  knobs: [
    { name: 'radius',   label: 'filter radius',           type: 'range',  min: 1,  max: 8,    step: 1,  default: 2 },
    { name: 'width',    label: 'image width',             type: 'range',  min: 64, max: 4096, step: 64, default: 1024 },
    { name: 'height',   label: 'image height',            type: 'range',  min: 64, max: 4096, step: 64, default: 1024 },
    { name: 'tile',     label: 'tile / block size',       type: 'range',  min: 8,  max: 32,   step: 8,  default: 16 },
    { name: 'strategy', label: 'strategy',                type: 'select', default: 'naive',
      options: ['naive', 'constant-mem', 'shared-tiled'] },
  ],

  // pure, offline, no GPU. global loads per output pixel, decomposed into input and
  // filter traffic, for every strategy. the view picks naive + the selected one.
  predict(knobs, _device) {
    const r = knobs.radius, W = knobs.width, H = knobs.height, T = knobs.tile;
    const K = 2 * r + 1;       // filter edge
    const tw = T + 2 * r;      // shared tile edge incl. halo
    const model = {
      // naive: input neighborhood read from global per output pixel, filter also read
      // from global per thread.
      'naive':        { input: K * K,                 filter: K * K, total: K * K + K * K },
      // constant-mem: filter moved to constant memory -> off global; input unchanged.
      'constant-mem': { input: K * K,                 filter: 0,     total: K * K },
      // shared-tiled: a (T+2r)^2 input tile staged once in shared serves T^2 outputs;
      // amortized global input loads per output pixel trend toward ~1 + halo.
      'shared-tiled': { input: (tw * tw) / (T * T),   filter: 0,     total: (tw * tw) / (T * T),
                        sharedBytes: tw * tw * 4 },
    };
    return { radius: r, width: W, height: H, tile: T, strategy: knobs.strategy, K, model, selected: model[knobs.strategy] };
  },

  getKnobs() { return null; },
  setKnobs(_values) {},

  specimen: {
    // ncu metric ids: three throughputs (proven family), sectors/request for global
    // loads, and branch-target uniformity. validated on first run; a rejected id fails
    // the run with the name in raw output and gets swapped.
    metrics: [
      'gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed',
      'l1tex__throughput.avg.pct_of_peak_sustained_active',
      'lts__throughput.avg.pct_of_peak_sustained_active',
      'l1tex__average_t_sectors_per_request_pipe_lsu_mem_global_op_ld.ratio',
      'smsp__sass_average_branch_targets_threads_uniform.pct',
    ],

    // emit a complete, launchable .cu for the selected strategy. knob values are baked
    // in as literals (sizes the constant/shared arrays at compile time). single kernel
    // named "stencil" so ncu profiles one clean target.
    generate(knobs) {
      const r = knobs.radius, W = knobs.width, H = knobs.height, T = knobs.tile;
      const head = `#include <cstdio>
#include <cstdlib>
#include <cuda_runtime.h>
#define R ${r}
#define W ${W}
#define H ${H}
#define T ${T}
#define K (2*R+1)
`;
      if (knobs.strategy === 'naive') {
        return head + `__global__ void stencil(const float* in, const float* filt, float* out){
  int x = blockIdx.x*blockDim.x + threadIdx.x;
  int y = blockIdx.y*blockDim.y + threadIdx.y;
  if (x>=W || y>=H) return;
  float acc=0.0f;
  for(int dy=-R; dy<=R; dy++) for(int dx=-R; dx<=R; dx++){
    int ix=x+dx, iy=y+dy;
    if(ix>=0 && ix<W && iy>=0 && iy<H){
      float f = filt[(dy+R)*K + (dx+R)];
      acc += f * in[iy*W + ix];
    }
  }
  out[y*W + x] = acc;
}
int main(){
  size_t npix=(size_t)W*H, nf=(size_t)K*K;
  float *in,*filt,*out;
  cudaMallocManaged(&in, npix*sizeof(float));
  cudaMallocManaged(&filt, nf*sizeof(float));
  cudaMallocManaged(&out, npix*sizeof(float));
  for(size_t i=0;i<npix;i++) in[i]=1.0f;
  for(size_t i=0;i<nf;i++) filt[i]=1.0f/(float)(K*K);
  dim3 block(T,T); dim3 grid((W+T-1)/T,(H+T-1)/T);
  stencil<<<grid,block>>>(in,filt,out);
  cudaDeviceSynchronize();
  cudaFree(in); cudaFree(filt); cudaFree(out);
  return 0;
}
`;
      }
      if (knobs.strategy === 'constant-mem') {
        return head + `__constant__ float c_filt[K*K];
__global__ void stencil(const float* in, float* out){
  int x = blockIdx.x*blockDim.x + threadIdx.x;
  int y = blockIdx.y*blockDim.y + threadIdx.y;
  if (x>=W || y>=H) return;
  float acc=0.0f;
  for(int dy=-R; dy<=R; dy++) for(int dx=-R; dx<=R; dx++){
    int ix=x+dx, iy=y+dy;
    if(ix>=0 && ix<W && iy>=0 && iy<H){
      acc += c_filt[(dy+R)*K + (dx+R)] * in[iy*W + ix];
    }
  }
  out[y*W + x] = acc;
}
int main(){
  size_t npix=(size_t)W*H, nf=(size_t)K*K;
  float *in,*out; float* hf=(float*)malloc(nf*sizeof(float));
  cudaMallocManaged(&in, npix*sizeof(float));
  cudaMallocManaged(&out, npix*sizeof(float));
  for(size_t i=0;i<npix;i++) in[i]=1.0f;
  for(size_t i=0;i<nf;i++) hf[i]=1.0f/(float)(K*K);
  cudaMemcpyToSymbol(c_filt, hf, nf*sizeof(float));
  dim3 block(T,T); dim3 grid((W+T-1)/T,(H+T-1)/T);
  stencil<<<grid,block>>>(in,out);
  cudaDeviceSynchronize();
  cudaFree(in); cudaFree(out); free(hf);
  return 0;
}
`;
      }
      // shared-tiled
      return head + `#define TW (T+2*R)
__constant__ float c_filt[K*K];
__global__ void stencil(const float* in, float* out){
  __shared__ float tile[TW*TW];
  int tx=threadIdx.x, ty=threadIdx.y;
  int x0=blockIdx.x*T, y0=blockIdx.y*T;
  for(int j=ty;j<TW;j+=T) for(int i=tx;i<TW;i+=T){
    int gx=x0+i-R, gy=y0+j-R;
    float v=0.0f;
    if(gx>=0 && gx<W && gy>=0 && gy<H) v=in[gy*W+gx];
    tile[j*TW+i]=v;
  }
  __syncthreads();
  int x=x0+tx, y=y0+ty;
  if(x<W && y<H){
    float acc=0.0f;
    for(int dy=0;dy<K;dy++) for(int dx=0;dx<K;dx++)
      acc += c_filt[dy*K+dx] * tile[(ty+dy)*TW + (tx+dx)];
    out[y*W + x] = acc;
  }
}
int main(){
  size_t npix=(size_t)W*H, nf=(size_t)K*K;
  float *in,*out; float* hf=(float*)malloc(nf*sizeof(float));
  cudaMallocManaged(&in, npix*sizeof(float));
  cudaMallocManaged(&out, npix*sizeof(float));
  for(size_t i=0;i<npix;i++) in[i]=1.0f;
  for(size_t i=0;i<nf;i++) hf[i]=1.0f/(float)(K*K);
  cudaMemcpyToSymbol(c_filt, hf, nf*sizeof(float));
  dim3 block(T,T); dim3 grid((W+T-1)/T,(H+T-1)/T);
  stencil<<<grid,block>>>(in,out);
  cudaDeviceSynchronize();
  cudaFree(in); cudaFree(out); free(hf);
  return 0;
}
`;
    },
  },

  // predicted model beside measured counters. naive baseline next to the selected
  // strategy by its real name. no "better/worse", no match score — the numbers stand;
  // the reader connects them.
  view(predicted, measured) {
    const p = predicted;
    const el = document.createElement('div');
    const fmt = (n) => (typeof n === 'number' ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '-');
    const naive = p.model['naive'];
    const sel = p.selected;
    const name = p.strategy;

    const predictedHtml = `
      <h3>predicted — global loads per output pixel</h3>
      <table>
        <thead><tr><th></th><th>naive</th><th>${name}</th></tr></thead>
        <tbody>
          <tr><td>input</td><td class="num">${fmt(naive.input)}</td><td class="num">${fmt(sel.input)}</td></tr>
          <tr><td>filter</td><td class="num">${fmt(naive.filter)}</td><td class="num">${fmt(sel.filter)}</td></tr>
          <tr><td>total</td><td class="num">${fmt(naive.total)}</td><td class="num">${fmt(sel.total)}</td></tr>
        </tbody>
      </table>
      ${sel.sharedBytes != null ? `<div class="sub">${name} shared mem / block: ${fmt(sel.sharedBytes)} bytes</div>` : ''}
      <div class="sub">filter ${p.K}×${p.K} · image ${p.width}×${p.height} · tile ${p.tile}×${p.tile}</div>
    `;

    const labels = {
      'gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed': 'DRAM throughput (% peak)',
      'l1tex__throughput.avg.pct_of_peak_sustained_active': 'L1/TEX throughput (% peak)',
      'lts__throughput.avg.pct_of_peak_sustained_active': 'L2 throughput (% peak)',
      'l1tex__average_t_sectors_per_request_pipe_lsu_mem_global_op_ld.ratio': 'sectors / request (global ld)',
      'smsp__sass_average_branch_targets_threads_uniform.pct': 'branch efficiency (% uniform)',
    };
    let measuredHtml;
    if (!measured) {
      measuredHtml = `<h3>measured — ${name}</h3><div class="muted">not measured yet — press “run on gpu”.</div>`;
    } else if (!measured.ok) {
      measuredHtml = `<h3>measured — ${name}</h3><div class="warn">run failed at ${measured.stage}: ${measured.error}</div>`;
    } else {
      const rows = Object.keys(labels).map((id) => {
        const v = measured.metrics[id];
        return `<tr><td>${labels[id]}</td><td class="num">${v == null ? '-' : fmt(v)}</td></tr>`;
      }).join('');
      measuredHtml = `<h3>measured — ${name} (last gpu run)</h3><table><tbody>${rows}</tbody></table>`;
    }

    el.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:start;">
        <div>${predictedHtml}</div>
        <div>${measuredHtml}</div>
      </div>
    `;
    return el;
  },
};
