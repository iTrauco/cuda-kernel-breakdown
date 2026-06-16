export function buildKernel(knobs) {
  const { mode='streaming', n=1<<20, stride=1, block=256, vecWidth=1 } = knobs;
  const vtype = vecWidth===4?'float4':vecWidth===2?'float2':'float';
  const index = mode==='strided'
    ? `int i = (blockIdx.x*blockDim.x+threadIdx.x)*${stride}; if (i>=n) return;`
    : `int i = blockIdx.x*blockDim.x+threadIdx.x; if (i>=n) return;`;
  const body = vecWidth===1
    ? `out[i] = a*x[i] + y[i];`
    : `${vtype} xv=x[i], yv=y[i], ov; ov.x=a*xv.x+yv.x; ov.y=a*xv.y+yv.y; ${vecWidth===4?'ov.z=a*xv.z+yv.z; ov.w=a*xv.w+yv.w;':''} out[i]=ov;`;
  return `#include <cstdio>
#include <cuda_runtime.h>
__global__ void work(const ${vtype}* x, const ${vtype}* y, ${vtype}* out, float a, int n){ ${index} ${body} }
int main(){
  int n=${Math.floor(n/vecWidth)};
  size_t bytes=(size_t)n*sizeof(${vtype});
  ${vtype} *x,*y,*o;
  cudaMallocManaged(&x,bytes); cudaMallocManaged(&y,bytes); cudaMallocManaged(&o,bytes);
  for(int i=0;i<n;i++){ ${vecWidth===1?'x[i]=1.0f; y[i]=2.0f;':`x[i].x=1;x[i].y=1;y[i].x=2;y[i].y=2;${vecWidth===4?'x[i].z=1;x[i].w=1;y[i].z=2;y[i].w=2;':''}`} }
  int block=${block}; int grid=(n+block-1)/block;
  work<<<grid,block>>>(x,y,o,2.0f,n);
  cudaDeviceSynchronize();
  cudaFree(x); cudaFree(y); cudaFree(o);
  return 0;
}
`;
}
