export type Vec3 = readonly [number, number, number];

export type ZoneKind = "site" | "floor" | "room";

export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly kind: ZoneKind;
  readonly floor: number;
  readonly parentId: string | null;
  readonly box: Box;
}

export interface ZoneRegistry {
  readonly zones: readonly Zone[];
  byId(id: string): Zone | undefined;
  at(point: Vec3): Zone | undefined;
}

export const DEFAULT_FLOORS = 6;
export const FLOOR_HEIGHT = 4;
export const MIN_FLOORS = 2;
export const MAX_FLOORS = 40;

// x/z in metres, centre at the origin. Boxes are half-open: min inclusive, max exclusive.
export const FOOTPRINTS = {
  campus: { x: [-60, 60], z: [-60, 60] },
  tower: { x: [-15, 15], z: [-15, 15] },
  garage: { x: [20, 50], z: [-30, 10] },
  loadingBay: { x: [-50, -25], z: [-20, 5] },
  breakRoom: { x: [-13, -3], z: [5, 13] },
  serverRoom: { x: [3, 13], z: [-13, -5] },
} as const;

type Footprint = { readonly x: readonly number[]; readonly z: readonly number[] };

export class ZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZoneError";
  }
}

const AXES = [0, 1, 2] as const;

function bandOf(floor: number): readonly [number, number] {
  return [floor * FLOOR_HEIGHT, (floor + 1) * FLOOR_HEIGHT];
}

function boxOf(footprint: Footprint, y: readonly [number, number]): Box {
  return {
    min: [footprint.x[0]!, y[0], footprint.z[0]!],
    max: [footprint.x[1]!, y[1], footprint.z[1]!],
  };
}

function quote(id: string): string {
  return `"${id}"`;
}

// Throws ZoneError naming the offending ids; the rules are listed in docs/plans/2.1-isometric-stage.md.
export function validateZones(zones: readonly Zone[]): void {
  const byId = new Map<string, Zone>();
  for (const z of zones) {
    if (byId.has(z.id)) throw new ZoneError(`duplicate zone id ${quote(z.id)}`);
    byId.set(z.id, z);
  }
  for (const z of zones) {
    if (z.parentId !== null && !byId.has(z.parentId)) {
      throw new ZoneError(`zone ${quote(z.id)} has missing parent ${quote(z.parentId)}`);
    }
  }
  for (const z of zones) {
    const seen = new Set<string>();
    for (
      let cur: Zone | undefined = z;
      cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    ) {
      if (seen.has(cur.id)) throw new ZoneError(`parent cycle through ${quote(cur.id)}`);
      seen.add(cur.id);
    }
  }
  for (const z of zones) {
    for (const axis of AXES) {
      const lo = z.box.min[axis]!;
      const hi = z.box.max[axis]!;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) {
        throw new ZoneError(`zone ${quote(z.id)} has an invalid box on axis ${axis}`);
      }
    }
    const parent = z.parentId === null ? undefined : byId.get(z.parentId);
    if (parent) {
      for (const axis of AXES) {
        if (z.box.min[axis]! < parent.box.min[axis]! || z.box.max[axis]! > parent.box.max[axis]!) {
          throw new ZoneError(`zone ${quote(z.id)} lies outside parent ${quote(parent.id)}`);
        }
      }
    }
    if (z.kind !== "site") {
      const [lo, hi] = bandOf(z.floor);
      if (z.box.min[1] < lo || z.box.max[1] > hi) {
        throw new ZoneError(`zone ${quote(z.id)} lies outside its floor band of floor ${z.floor}`);
      }
    }
  }
  for (let i = 0; i < zones.length; i++) {
    const a = zones[i]!;
    if (a.parentId === null) continue;
    for (let j = i + 1; j < zones.length; j++) {
      const b = zones[j]!;
      if (b.parentId !== a.parentId) continue;
      const overlaps = AXES.every(
        (axis) =>
          Math.max(a.box.min[axis]!, b.box.min[axis]!) <
          Math.min(a.box.max[axis]!, b.box.max[axis]!),
      );
      if (overlaps) throw new ZoneError(`sibling zones ${quote(a.id)} and ${quote(b.id)} overlap`);
    }
  }
}

function deepFreeze(zone: Zone): Zone {
  Object.freeze(zone.box.min);
  Object.freeze(zone.box.max);
  Object.freeze(zone.box);
  return Object.freeze(zone);
}

function buildZones(floors: number): Zone[] {
  const T = floors - 1;
  const level = (id: string, name: string, floor: number, footprint: Footprint): Zone => ({
    id,
    name,
    kind: "floor",
    floor,
    parentId: "campus",
    box: boxOf(footprint, bandOf(floor)),
  });
  const room = (id: string, name: string, floor: number, footprint: Footprint): Zone => ({
    id,
    name,
    kind: "room",
    floor,
    parentId: `floor-${floor}`,
    box: boxOf(footprint, bandOf(floor)),
  });
  const zones: Zone[] = [
    {
      id: "campus",
      name: "Campus",
      kind: "site",
      floor: 0,
      parentId: null,
      box: boxOf(FOOTPRINTS.campus, [0, (floors + 1) * FLOOR_HEIGHT]),
    },
    level("lobby", "Lobby", 0, FOOTPRINTS.tower),
    level("garage", "Garage", 0, FOOTPRINTS.garage),
    level("loading-bay", "Loading bay", 0, FOOTPRINTS.loadingBay),
  ];
  for (let k = 1; k <= T; k++) zones.push(level(`floor-${k}`, `Floor ${k}`, k, FOOTPRINTS.tower));
  zones.push(
    room("break-room", "Break room", 1, FOOTPRINTS.breakRoom),
    room("server-room", "Server room", T, FOOTPRINTS.serverRoom),
    level("roof", "Roof", floors, FOOTPRINTS.tower),
  );
  return zones;
}

// `floors` counts the lobby: lobby is floor 0, offices are 1..floors-1, the roof is floor `floors`.
export function createZoneRegistry({ floors }: { floors: number }): ZoneRegistry {
  if (!Number.isInteger(floors) || floors < MIN_FLOORS || floors > MAX_FLOORS) {
    throw new RangeError(
      `floors must be an integer in [${MIN_FLOORS}, ${MAX_FLOORS}], got ${String(floors)}`,
    );
  }
  const built = buildZones(floors);
  validateZones(built);
  const zones = Object.freeze(built.map(deepFreeze));
  const index = new Map(zones.map((z) => [z.id, z]));
  const depth = new Map<string, number>();
  for (const z of zones) {
    let d = 0;
    for (let p = z.parentId; p !== null; p = index.get(p)!.parentId) d++;
    depth.set(z.id, d);
  }
  const campus = index.get("campus")!;
  return {
    zones,
    byId: (id) => index.get(id),
    at(point) {
      for (const value of point) {
        if (!Number.isFinite(value))
          throw new TypeError(`zones.at: non-finite coordinate ${value}`);
      }
      const inside = (z: Zone) =>
        AXES.every((axis) => point[axis]! >= z.box.min[axis]! && point[axis]! < z.box.max[axis]!);
      if (!inside(campus)) return undefined;
      let best: Zone | undefined;
      for (const z of zones) {
        if (inside(z) && (!best || depth.get(z.id)! > depth.get(best.id)!)) best = z;
      }
      return best;
    },
  };
}
