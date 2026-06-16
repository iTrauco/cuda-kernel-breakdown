// pure occupancy math. no DOM. all limits come in via a device spec object.
// rounds up to whole warps, mirrors how the hardware allocates.

const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
const roundUp = (a, b) => Math.ceil(a / b) * b;

// warps a single block needs (threads padded up to a full warp)
export function warpsPerBlock(blockSize, warpSize) {
  return ceilDiv(blockSize, warpSize);
}

// max resident blocks per SM, limited by each resource independently.
// returns the per-resource caps plus the binding limiter.
export function blocksPerSM(params, dev) {
  const { blockSize, regsPerThread, sharedPerBlock } = params;
  const wpb = warpsPerBlock(blockSize, dev.warpSize);

  // hard cap: scheduler slots for blocks
  const byBlocks = dev.maxBlocksPerSM;

  // warp slots: total resident warps / warps each block uses
  const byWarps = Math.floor(dev.maxWarpsPerSM / wpb);

  // registers: regs allocate per-warp, rounded to the alloc granularity
  let byRegs = Infinity;
  if (regsPerThread > 0) {
    const regsPerWarp = roundUp(regsPerThread * dev.warpSize, dev.regAllocUnit);
    const warpsByRegs = Math.floor(dev.regsPerSM / regsPerWarp);
    byRegs = Math.floor(warpsByRegs / wpb);
  }

  // shared memory: per-block, rounded to the alloc granularity
  let bySmem = Infinity;
  if (sharedPerBlock > 0) {
    const smemPerBlock = roundUp(sharedPerBlock, dev.smemAllocUnit);
    bySmem = Math.floor(dev.smemPerSM / smemPerBlock);
  }

  const caps = { blocks: byBlocks, warps: byWarps, registers: byRegs, shared: bySmem };
  const active = Math.min(byBlocks, byWarps, byRegs, bySmem);

  // which resource binds (smallest cap)
  let limiter = 'blocks';
  let min = byBlocks;
  for (const [k, v] of Object.entries(caps)) {
    if (v < min) { min = v; limiter = k; }
  }

  return { activeBlocksPerSM: Math.max(active, 0), caps, limiter, warpsPerBlock: wpb };
}

// full occupancy result for a launch config on a device
export function computeOccupancy(params, dev) {
  const b = blocksPerSM(params, dev);
  const activeWarps = b.activeBlocksPerSM * b.warpsPerBlock;
  const occupancy = activeWarps / dev.maxWarpsPerSM; // 0..1
  return {
    ...b,
    activeWarpsPerSM: activeWarps,
    maxWarpsPerSM: dev.maxWarpsPerSM,
    occupancy,
    occupancyPct: Math.round(occupancy * 100),
  };
}
