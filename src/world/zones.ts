import { TOWER_HALF, ZoneError } from "./dimensions";
import { LAYOUT_SEED, buildLayout, type Layout, type RoomType } from "./layout";

export type Vec3 = readonly [number, number, number];

export type ZoneKind = "site" | "floor" | "room";

export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

interface ZoneBase {
  readonly id: string;
  readonly name: string;
  readonly floor: number;
  readonly parentId: string | null;
  readonly box: Box;
}

export interface SiteZone extends ZoneBase {
  readonly kind: "site";
}

export interface FloorZone extends ZoneBase {
  readonly kind: "floor";
}

export interface RoomZone extends ZoneBase {
  readonly kind: "room";
  readonly roomType: RoomType;
}

export type Zone = SiteZone | FloorZone | RoomZone;

export interface ZoneRegistry {
  readonly zones: readonly Zone[];
  // The floor layout the room zones came from: walls, doors, anchors, desk slots and tower openings.
  readonly layout: Layout;
  byId(id: string): Zone | undefined;
  at(point: Vec3): Zone | undefined;
}

export const DEFAULT_FLOORS = 6;
export const FLOOR_HEIGHT = 6;
export const MIN_FLOORS = 2;
export const MAX_FLOORS = 40;

// x/z in metres, centre at the origin. Boxes are half-open: min inclusive, max exclusive.
export const FOOTPRINTS = {
  campus: { x: [-60, 60], z: [-60, 60] },
  tower: { x: [-TOWER_HALF, TOWER_HALF], z: [-TOWER_HALF, TOWER_HALF] },
  garage: { x: [20, 50], z: [-30, 10] },
  loadingBay: { x: [-50, -25], z: [-20, 5] },
} as const;

type Footprint = { readonly x: readonly number[]; readonly z: readonly number[] };

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
    if (byId.has(z.id)) throw new ZoneError(`duplicate zone id ${quote(z.id)} on floor ${z.floor}`);
    byId.set(z.id, z);
  }
  for (const z of zones) {
    if (z.parentId !== null && !byId.has(z.parentId)) {
      throw new ZoneError(
        `zone ${quote(z.id)} on floor ${z.floor} has missing parent ${quote(z.parentId)}`,
      );
    }
  }
  for (const z of zones) {
    const seen = new Set<string>();
    for (
      let cur: Zone | undefined = z;
      cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    ) {
      if (seen.has(cur.id))
        throw new ZoneError(`parent cycle through ${quote(cur.id)} on floor ${cur.floor}`);
      seen.add(cur.id);
    }
  }
  for (const z of zones) {
    for (const axis of AXES) {
      const lo = z.box.min[axis]!;
      const hi = z.box.max[axis]!;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) {
        throw new ZoneError(
          `zone ${quote(z.id)} on floor ${z.floor} has an invalid box on axis ${axis}`,
        );
      }
    }
    const parent = z.parentId === null ? undefined : byId.get(z.parentId);
    if (parent) {
      for (const axis of AXES) {
        if (z.box.min[axis]! < parent.box.min[axis]! || z.box.max[axis]! > parent.box.max[axis]!) {
          throw new ZoneError(
            `zone ${quote(z.id)} on floor ${z.floor} lies outside parent ${quote(parent.id)}`,
          );
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
      if (overlaps) {
        throw new ZoneError(
          `sibling zones ${quote(a.id)} and ${quote(b.id)} overlap on floor ${a.floor}`,
        );
      }
    }
  }
}

function deepFreeze(zone: Zone): Zone {
  Object.freeze(zone.box.min);
  Object.freeze(zone.box.max);
  Object.freeze(zone.box);
  return Object.freeze(zone);
}

function roomZones(layout: Layout): Zone[] {
  return layout.levels.flatMap((level) =>
    level.rooms.map((r): Zone => {
      const [lo, hi] = bandOf(r.floor);
      return {
        id: r.id,
        name: r.name,
        kind: "room",
        roomType: r.roomType,
        floor: r.floor,
        parentId: r.parentId,
        box: {
          min: [r.min[0], lo, r.min[1]],
          max: [r.max[0], r.height === undefined ? hi : lo + r.height, r.max[1]],
        },
      };
    }),
  );
}

function buildZones(floors: number, layout: Layout): Zone[] {
  const T = floors - 1;
  const level = (id: string, name: string, floor: number, footprint: Footprint): Zone => ({
    id,
    name,
    kind: "floor",
    floor,
    parentId: "campus",
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
  zones.push(level("roof", "Roof", floors, FOOTPRINTS.tower), ...roomZones(layout));
  return zones;
}

// The one floor-count guard: the registry and the tower builder both call it.
export function assertFloors(floors: number): void {
  if (!Number.isInteger(floors) || floors < MIN_FLOORS || floors > MAX_FLOORS) {
    throw new RangeError(
      `floors must be an integer in [${MIN_FLOORS}, ${MAX_FLOORS}], got ${String(floors)}`,
    );
  }
}

// `floors` counts the lobby: lobby is floor 0, offices are 1..floors-1, the roof is floor `floors`.
export function createZoneRegistry({ floors }: { floors: number }): ZoneRegistry {
  assertFloors(floors);
  const layout = buildLayout({ floors, seed: LAYOUT_SEED });
  const built = buildZones(floors, layout);
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
    layout,
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
