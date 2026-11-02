import { describe, expect, it } from "vite-plus/test";
import { hashSeed, mulberry32 } from "./rng";

const take = (next: () => number, n: number) => Array.from({ length: n }, next);

describe("mulberry32", () => {
  it("gives the same sequence for the same seed", () => {
    expect(take(mulberry32(42), 20)).toEqual(take(mulberry32(42), 20));
  });

  it("gives different sequences for different seeds", () => {
    expect(take(mulberry32(1), 8)).not.toEqual(take(mulberry32(2), 8));
  });

  it("keeps every output in [0, 1)", () => {
    const next = mulberry32(0xdeadbeef);
    for (let i = 0; i < 10_000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("normalises the seed: 0 behaves as 1, and seeds wrap modulo 2^32", () => {
    expect(take(mulberry32(0), 8)).toEqual(take(mulberry32(1), 8));
    expect(take(mulberry32(2 ** 32 + 5), 8)).toEqual(take(mulberry32(5), 8));
    expect(take(mulberry32(-1), 8)).toEqual(take(mulberry32(0xffffffff), 8));
  });

  it("does not degenerate on seed 0 (not a constant stream)", () => {
    expect(new Set(take(mulberry32(0), 16)).size).toBeGreaterThan(8);
  });
});

describe("hashSeed", () => {
  it("is deterministic and an unsigned 32-bit integer", () => {
    expect(hashSeed(7, 3)).toBe(hashSeed(7, 3));
    const h = hashSeed(7, 3);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it("gives every floor its own stream", () => {
    const seeds = new Set(Array.from({ length: 41 }, (_, f) => hashSeed(7, f)));
    expect(seeds.size).toBe(41);
    expect(take(mulberry32(hashSeed(7, 0)), 8)).not.toEqual(take(mulberry32(hashSeed(7, 1)), 8));
  });

  it("depends on the seed", () => {
    expect(hashSeed(1, 5)).not.toBe(hashSeed(2, 5));
  });
});
