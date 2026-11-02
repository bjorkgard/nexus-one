// Seed as an unsigned 32-bit integer; 0 maps to 1 so a zero seed does not start from a degenerate state.
function normaliseSeed(seed: number): number {
  return seed >>> 0 || 1;
}

// mulberry32: a small 32-bit PRNG. Returns a function that yields floats in [0, 1).
export function mulberry32(seed: number): () => number {
  let state = normaliseSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One unsigned 32-bit seed per (seed, stream), so each floor gets its own stream and one floor's
// layout does not depend on how many floors exist.
export function hashSeed(seed: number, stream: number): number {
  let h = normaliseSeed(seed) ^ Math.imul((stream >>> 0) + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
