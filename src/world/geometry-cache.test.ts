import { BoxGeometry, BufferGeometry, Color, InstancedMesh, MeshBasicMaterial } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { __clearGeometryCache, geometryCacheStats, getGeometry } from "./geometry-cache";

const box = () => new BoxGeometry(1, 1, 1);

beforeEach(() => {
  __clearGeometryCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getGeometry", () => {
  it("returns the same instance per key and builds once", () => {
    // Value: protects=one shared geometry per key; fails_when=the cache rebuilds on a hit; why_new=cache is new; seam=none; no_claim=GPU upload
    const build = vi.fn(box);
    const a = getGeometry("slab", { w: 1 }, build);
    const b = getGeometry("slab", { w: 1 }, build);
    expect(a).toBe(b);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("returns a new instance per differing param or kind", () => {
    const a = getGeometry("slab", { w: 1 }, box);
    expect(getGeometry("slab", { w: 2 }, box)).not.toBe(a);
    expect(getGeometry("other", { w: 1 }, box)).not.toBe(a);
  });

  it("maps key order, float noise and negative zero to one key", () => {
    const a = getGeometry("k", { a: 1, b: 2 }, box);
    expect(getGeometry("k", { b: 2, a: 1 }, box)).toBe(a);
    expect(getGeometry("k", { a: 1.00000001, b: 2 }, box)).toBe(a);
    // -0 needs no case of its own: JSON.stringify(-0) is "0", so it cannot differ from 0. A tiny negative
    // rounds to -0 and must still share the key with 0.
    const z = getGeometry("z", { a: 0 }, box);
    expect(getGeometry("z", { a: -0.00001 }, box)).toBe(z);
    expect(getGeometry("z", { a: -0 }, box)).toBe(z);
    expect(geometryCacheStats().size).toBe(2);
  });

  it("keeps strings and booleans distinct from numbers", () => {
    const a = getGeometry("k", { a: 1 }, box);
    expect(getGeometry("k", { a: "1" }, box)).not.toBe(a);
    expect(getGeometry("k", { a: true }, box)).not.toBe(a);
  });

  it("throws RangeError naming kind and param for a non-finite number", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => getGeometry("slab", { depth: bad }, box)).toThrow(RangeError);
    }
    expect(() => getGeometry("slab", { width: NaN }, box)).toThrow(/slab.*"width"/);
    expect(geometryCacheStats().size).toBe(0);
  });

  it("throws TypeError naming kind and param for a nested value", () => {
    const nested = { a: { b: 1 } } as never;
    expect(() => getGeometry("slab", nested, box)).toThrow(TypeError);
    const named = { width: { b: 1 } } as never;
    expect(() => getGeometry("slab", named, box)).toThrow(/slab.*"width"/);
    expect(() => getGeometry("slab", { a: [1] } as never, box)).toThrow(TypeError);
  });

  it("propagates a builder error and stores nothing", () => {
    const boom = () => {
      throw new Error("boom");
    };
    expect(() => getGeometry("slab", { w: 1 }, boom)).toThrow("boom");
    expect(geometryCacheStats().size).toBe(0);
    const build = vi.fn(box);
    getGeometry("slab", { w: 1 }, build);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("first build for a key wins", () => {
    const first = new BufferGeometry();
    const a = getGeometry("k", { a: 1 }, () => first);
    expect(getGeometry("k", { a: 1 }, box)).toBe(a);
    expect(a).toBe(first);
  });

  it("getGeometry never disposes; clear disposes only what it removes", () => {
    const kept = getGeometry("keep", { a: 1 }, box);
    const gone = getGeometry("gone", { a: 1 }, box);
    const keptSpy = vi.spyOn(kept, "dispose");
    const goneSpy = vi.spyOn(gone, "dispose");
    getGeometry("keep", { a: 1 }, box);
    getGeometry("gone", { a: 1 }, box);
    expect(keptSpy).not.toHaveBeenCalled();
    expect(goneSpy).not.toHaveBeenCalled();
    __clearGeometryCache(["gone"]);
    expect(goneSpy).toHaveBeenCalledTimes(1);
    expect(keptSpy).not.toHaveBeenCalled();
    __clearGeometryCache();
    expect(keptSpy).toHaveBeenCalledTimes(1);
  });

  it("counts hits and misses", () => {
    getGeometry("k", { a: 1 }, box);
    getGeometry("k", { a: 1 }, box);
    getGeometry("k", { a: 1 }, box);
    getGeometry("k", { a: 2 }, box);
    expect(geometryCacheStats()).toEqual({ size: 2, hits: 2, misses: 2 });
  });

  it("warns once when distinct keys pass 256", () => {
    // Value: protects=key-explosion warning; fails_when=threshold off by one or warns repeatedly; why_new=cache is new; seam=none; no_claim=DEV flag in prod build
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 256; i++) getGeometry("k", { i }, box);
    expect(warn).not.toHaveBeenCalled();
    getGeometry("k", { i: 256 }, box);
    expect(warn).toHaveBeenCalledTimes(1);
    getGeometry("k", { i: 257 }, box);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("__clearGeometryCache", () => {
  it("empties the cache and zeroes stats when clearing all", () => {
    getGeometry("k", { a: 1 }, box);
    getGeometry("k", { a: 1 }, box);
    __clearGeometryCache();
    expect(geometryCacheStats()).toEqual({ size: 0, hits: 0, misses: 0 });
  });

  it("removes only the given kinds", () => {
    const slab = getGeometry("slab", {}, box);
    const swatch = getGeometry("swatch-box", {}, box);
    __clearGeometryCache(["slab"]);
    expect(geometryCacheStats().size).toBe(1);
    expect(getGeometry("swatch-box", {}, box)).toBe(swatch);
    expect(getGeometry("slab", {}, box)).not.toBe(slab);
  });

  it("does not remove a kind that only shares a prefix", () => {
    getGeometry("swatch", { a: 1 }, box);
    const other = getGeometry("swatch-box", { a: 1 }, box);
    __clearGeometryCache(["swatch"]);
    expect(getGeometry("swatch-box", { a: 1 }, box)).toBe(other);
  });
});

describe("shared geometry immutability (D12)", () => {
  it("setColorAt on one InstancedMesh leaves the other and the geometry unchanged", () => {
    // Value: protects=instance colour is per mesh, never on the shared geometry; fails_when=tint writes into a geometry attribute; why_new=D12 rule; seam=none; no_claim=rendered pixels
    const geometry = getGeometry("k", { a: 1 }, box);
    const material = new MeshBasicMaterial();
    const a = new InstancedMesh(geometry, material, 2);
    const b = new InstancedMesh(getGeometry("k", { a: 1 }, box), material, 2);
    const attrsBefore = Object.keys(geometry.attributes).sort();
    const positionBefore = Array.from(geometry.attributes.position.array);
    b.setColorAt(0, new Color(0.2, 0.3, 0.4));
    const bBefore = Array.from(b.instanceColor!.array);
    a.setColorAt(0, new Color(1, 0, 0));
    a.setColorAt(1, new Color(0, 1, 0));
    expect(Array.from(b.instanceColor!.array)).toEqual(bBefore);
    expect(a.instanceColor).not.toBe(b.instanceColor);
    expect(a.geometry).toBe(b.geometry);
    expect(Object.keys(geometry.attributes).sort()).toEqual(attrsBefore);
    expect(Array.from(geometry.attributes.position.array)).toEqual(positionBefore);
  });
});
