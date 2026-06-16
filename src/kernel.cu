#include <cstdio>
#include <cstdlib>

__global__ void kernelToRun(const float* in, float* out, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    out[idx] = in[idx];
}

int main() {
    int n = 1 << 20;                 // 1,048,576 elements, change this
    size_t bytes = n * sizeof(float);

    float *h_in = (float*)malloc(bytes);
    for (int i = 0; i < n; i++) h_in[i] = (float)i;

    float *d_in, *d_out;
    cudaMalloc(&d_in, bytes);
    cudaMalloc(&d_out, bytes);
    cudaMemcpy(d_in, h_in, bytes, cudaMemcpyHostToDevice);

    int blockSize = 256;             // change this
    int gridSize = (n + blockSize - 1) / blockSize;
    kernelToRun<<<gridSize, blockSize>>>(d_in, d_out, n);
    cudaDeviceSynchronize();

    cudaFree(d_in); cudaFree(d_out); free(h_in);
    return 0;
}
