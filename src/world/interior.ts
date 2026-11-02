import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { TOKENS } from "../shared/tokens";
import { GLASS_HALF } from "./dimensions";
import type { Layout, Rect, Wall } from "./layout";
import type { PaletteName } from "./palette";
import { LOOK } from "./stage-look";
import { floorTopY, type TowerPart, type TowerPartKind } from "./tower";
import { FLOOR_HEIGHT, type Vec3 } from "./zones";

const T = LOOK.tower;
const I = LOOK.interior;
const EPS = 1e-9;

// Every geometry-cache kind the interior builds; Stage clears these on HMR dispose.
export const INTERIOR_GEOMETRY_KINDS = ["interior-box", "interior-tint"] as const;

const IDENTITY = new Quaternion();
const box = (position: Vec3, size: Vec3) =>
  new Matrix4().compose(new Vector3(...position), IDENTITY, new Vector3(...size));

const unitBox = { kind: "interior-box", params: {} } as const;
const buildUnitBox = () => new BoxGeometry(1, 1, 1);

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])) *
  Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]));

// A wall on a glass face is the hull itself (the glass draws it): its outer face is on the glass line.
function isHull(w: Wall): boolean {
  const thinX = w.max[0] - w.min[0] < w.max[1] - w.min[1];
  const [lo, hi] = thinX ? [w.min[0], w.max[0]] : [w.min[1], w.max[1]];
  return Math.max(Math.abs(lo), Math.abs(hi)) >= GLASS_HALF - 1e-6;
}

// Whether a wall's extent along its own line reaches the hole's span on that line (touching counts).
function touchesHole(w: Wall, hole: Layout["openings"]["slabHole"], k: number): boolean {
  const a = 1 - k;
  return w.min[a]! <= hole.max[a]! + EPS && w.max[a]! >= hole.min[a]! - EPS;
}

// Rail walls are centred on the slab-hole edge, so half of one would hang over the void: slide any wall that
// overlaps the hole to the walkable side, its inner face on the hole edge. Walls of the same line beyond the
// hole that touch it slide with it, so the line has no 5 cm jog where the rail ends.
function onWalkableSide(w: Wall, hole: Layout["openings"]["slabHole"]): Rect {
  if (w.floor !== hole.floor) return w;
  const thinX = w.max[0] - w.min[0] < w.max[1] - w.min[1];
  const k = thinX ? 0 : 1;
  const t = I.wallThickness;
  const c = (w.min[k]! + w.max[k]!) / 2;
  const onEdgeLine = Math.abs(c - hole.min[k]!) < EPS || Math.abs(c - hole.max[k]!) < EPS;
  if (overlapArea(w, hole) < EPS && !(onEdgeLine && touchesHole(w, hole, k))) return w;
  const [lo, hi] =
    c < (hole.min[k]! + hole.max[k]!) / 2
      ? [hole.min[k]! - t, hole.min[k]!]
      : [hole.max[k]!, hole.max[k]! + t];
  return thinX
    ? { min: [lo, w.min[1]], max: [hi, w.max[1]] }
    : { min: [w.min[0], lo], max: [w.max[0], hi] };
}

const wallBox = (r: Rect, y: number, height: number) =>
  box(
    [(r.min[0] + r.max[0]) / 2, y + height / 2, (r.min[1] + r.max[1]) / 2],
    [r.max[0] - r.min[0], height, r.max[1] - r.min[1]],
  );

// One flat up-facing unit quad at y = 0, white so each room's instance colour sets its tint.
function buildTintQuad(): BufferGeometry {
  const geometry = new BufferGeometry();
  // Counter-clockwise seen from above, so the face looks up.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5],
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3),
  );
  geometry.setAttribute(
    "color",
    new Float32BufferAttribute(Array.from({ length: 6 }, () => [1, 1, 1]).flat(), 3),
  );
  return geometry;
}

// Interior parts from the layout, in the order `Tower` draws them: low partitions, the open core frame, per-type
// floor tints, the lobby furniture and the rooftop server penthouse. None casts or receives a shadow.
export function buildInterior(layout: Layout): TowerPart[] {
  const { floors } = layout;
  const hole = layout.openings.slabHole;
  const none = { cast: false, receive: false };
  const part = (
    kind: TowerPartKind,
    material: PaletteName,
    geometryKey: TowerPart["geometryKey"],
    buildGeometry: () => BufferGeometry,
    matrices: Matrix4[],
    floorOf: readonly number[],
    colors?: Color[],
  ): TowerPart => ({
    kind,
    material,
    castShadow: none.cast,
    receiveShadow: none.receive,
    geometryKey,
    buildGeometry,
    matrices,
    floorOf,
    ...(colors ? { colors } : {}),
  });

  const partitions: Matrix4[] = [];
  const partitionFloors: number[] = [];
  const frame: Matrix4[] = [];
  const frameFloors: number[] = [];
  const tints: Matrix4[] = [];
  const tintColors: Color[] = [];
  const tintFloors: number[] = [];
  const s = I.coreFrameSize;
  for (let k = 0; k < floors; k++) {
    const level = layout.levels[k]!;
    const top = floorTopY(k);
    for (const wall of level.walls) {
      if (isHull(wall)) continue;
      partitions.push(wallBox(onWalkableSide(wall, hole), top, I.partitionHeight));
      partitionFloors.push(k);
    }
    // Posts run from inside one slab to inside the next, like the tower columns.
    const y = top - T.slabThickness / 2 + FLOOR_HEIGHT / 2;
    const core = level.rooms.find((r) => r.roomType === "core")!;
    const [x0, z0] = core.min;
    const [x1, z1] = core.max;
    for (const x of [x0, x1])
      for (const z of [z0, z1]) frame.push(box([x, y, z], [s, FLOOR_HEIGHT, s]));
    for (const d of level.doors.filter((o) => o.roomId === core.id)) {
      for (const e of [d.lo - s / 2, d.hi + s / 2]) {
        frame.push(box(d.axis === "x" ? [e, y, d.at] : [d.at, y, e], [s, FLOOR_HEIGHT, s]));
      }
    }
    // One beam along each core edge under the slab above this floor (the roof deck for the top floor), so the
    // frame is ordered by floor and a floor cut is exact.
    const by = floorTopY(k + 1) - T.slabThickness - s / 2;
    frame.push(
      box([(x0 + x1) / 2, by, z0], [x1 - x0 + s, s, s]),
      box([(x0 + x1) / 2, by, z1], [x1 - x0 + s, s, s]),
      box([x0, by, (z0 + z1) / 2], [s, s, z1 - z0 + s]),
      box([x1, by, (z0 + z1) / 2], [s, s, z1 - z0 + s]),
    );
    while (frameFloors.length < frame.length) frameFloors.push(k);
  }
  // One quad per tinted room (corridors keep the slab's own colour), lifted `minGap` above the slab top: above
  // it, below the glow strip. Rooms never cover the floor-1 slab hole, so nothing is tinted over the void.
  for (const level of layout.levels) {
    for (const room of level.rooms) {
      if (room.roomType === "corridor") continue;
      const [rx0, rz0] = room.min;
      const [rx1, rz1] = room.max;
      const y = floorTopY(level.floor) + T.minGap;
      tints.push(box([(rx0 + rx1) / 2, y, (rz0 + rz1) / 2], [rx1 - rx0, 1, rz1 - rz0]));
      tintColors.push(new Color(TOKENS.room[room.roomType]));
      tintFloors.push(level.floor);
    }
  }

  const lobby = layout.levels[0]!;
  const base = floorTopY(0);
  const furniture: Matrix4[] = [];
  const furnitureColors: Color[] = [];
  for (const a of lobby.anchors) {
    const cxz: [number, number] = [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2];
    if (a.kind === "reception-desk") {
      const { length, depth, height } = I.receptionDesk;
      const alongX = a.max[0] - a.min[0] > a.max[1] - a.min[1];
      furniture.push(
        box(
          [cxz[0], base + height / 2, cxz[1]],
          alongX ? [length, height, depth] : [depth, height, length],
        ),
      );
      furnitureColors.push(new Color(TOKENS.surface.furniture));
    } else if (a.kind === "waiting-chair") {
      const { size, height } = I.chair;
      furniture.push(box([cxz[0], base + height / 2, cxz[1]], [size, height, size]));
      furnitureColors.push(new Color(TOKENS.surface.panel));
    }
  }

  const roofFloors = (m: Matrix4[]) => m.map(() => floors);
  const roofY = floorTopY(floors);
  const room = layout.levels[floors]!.rooms[0]!;
  const P = I.penthouse;
  const height = room.height ?? P.height;
  // Glass runs from the deck to the underside of the roof slab; the walls (door gap included) come from the layout.
  const glass = layout.levels[floors]!.walls.map((w) =>
    wallBox(w, roofY, height - P.roofThickness),
  );
  const [rx0, rz0] = room.min;
  const [rx1, rz1] = room.max;
  const roof = [
    box(
      [(rx0 + rx1) / 2, roofY + height - P.roofThickness / 2, (rz0 + rz1) / 2],
      [rx1 - rx0, P.roofThickness, rz1 - rz0],
    ),
  ];
  // Lit floor plate: cool white on `trimWhite`, the same material as the tower glow, so it never outshines it.
  const glow = [
    box(
      [(rx0 + rx1) / 2, roofY + T.glowLift + P.glowThickness / 2, (rz0 + rz1) / 2],
      [rx1 - rx0 - 2 * P.glowInset, P.glowThickness, rz1 - rz0 - 2 * P.glowInset],
    ),
  ];

  return [
    part("partition", "panel", unitBox, buildUnitBox, partitions, partitionFloors),
    part("coreFrame", "panel", unitBox, buildUnitBox, frame, frameFloors),
    part(
      "floorTint",
      "ground",
      { kind: "interior-tint", params: {} },
      buildTintQuad,
      tints,
      tintFloors,
      tintColors,
    ),
    part(
      "furniture",
      "furniture",
      unitBox,
      buildUnitBox,
      furniture,
      furniture.map(() => 0),
      furnitureColors,
    ),
    part("penthouseGlass", "glass", unitBox, buildUnitBox, glass, roofFloors(glass)),
    part("penthouseRoof", "panel", unitBox, buildUnitBox, roof, roofFloors(roof)),
    part("penthouseGlow", "trimWhite", unitBox, buildUnitBox, glow, roofFloors(glow)),
  ];
}
