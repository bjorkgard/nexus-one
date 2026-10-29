import type { BufferGeometry } from "three";

export type GeometryParams = Record<string, number | string | boolean>;
export type GeometryCacheStats = { size: number; hits: number; misses: number };

const WARN_KEY_COUNT = 256;

// App-lifetime: nothing here disposes. Cached geometry is shared and never edited after build.
const cache = new Map<string, { kind: string; geometry: BufferGeometry }>();
let hits = 0;
let misses = 0;
let warned = false;

export function canonicalKey(kind: string, params: GeometryParams): string {
  const entries: [string, number | string | boolean][] = [];
  for (const name of Object.keys(params).sort()) {
    const value: unknown = params[name];
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new RangeError(`getGeometry("${kind}"): non-finite param "${name}" (${value})`);
      }
      const rounded = Math.round(value * 1e4) / 1e4;
      entries.push([name, rounded === 0 ? 0 : rounded]);
    } else if (typeof value === "string" || typeof value === "boolean") {
      entries.push([name, value]);
    } else {
      throw new TypeError(
        `getGeometry("${kind}"): param "${name}" must be a number, string or boolean`,
      );
    }
  }
  return `${kind}:${JSON.stringify(entries)}`;
}

export function getGeometry(
  kind: string,
  params: GeometryParams,
  build: () => BufferGeometry,
): BufferGeometry {
  const key = canonicalKey(kind, params);
  const found = cache.get(key);
  if (found) {
    hits += 1;
    return found.geometry;
  }
  misses += 1;
  const geometry = build();
  cache.set(key, { kind, geometry });
  if (import.meta.env.DEV && !warned && cache.size > WARN_KEY_COUNT) {
    warned = true;
    console.warn(`geometry cache holds ${cache.size} keys; check for per-object params in a key`);
  }
  return geometry;
}

export function geometryCacheStats(): GeometryCacheStats {
  return { size: cache.size, hits, misses };
}

// Dev and test only: HMR dispose clears the caller's own kinds. Disposes nothing, live meshes remount.
export function __clearGeometryCache(kinds?: readonly string[]): void {
  if (!kinds) {
    cache.clear();
    hits = 0;
    misses = 0;
    warned = false;
    return;
  }
  for (const [key, entry] of cache) {
    if (kinds.includes(entry.kind)) cache.delete(key);
  }
}
