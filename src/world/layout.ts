import { GLASS_HALF, ZoneError } from "./dimensions";
import { hashSeed, mulberry32 } from "./rng";
import { LOOK } from "./stage-look";

// Changing LAYOUT_SEED, or any template constant in this file or in LOOK.interior, moves every desk
// (slot order and positions). Task 2.5 owns the migration policy for existing desk assignments.
export const LAYOUT_SEED = 0x4e5855;

export const ROOM_TYPES = [
  "core",
  "corridor",
  "office",
  "meeting",
  "restroom",
  "reception",
  "waiting",
  "escalator",
  "break-room",
  "server-room",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

// [x, z] in metres, tower centre at the origin.
export type Point2 = readonly [number, number];
export interface Rect {
  readonly min: Point2;
  readonly max: Point2;
}

// A zone input: zones.ts turns it into a `RoomZone` (full floor band, or `height` for the penthouse).
export interface RoomSpec extends Rect {
  readonly id: string;
  readonly name: string;
  readonly roomType: RoomType;
  readonly floor: number;
  readonly parentId: string;
  readonly height?: number;
}

export interface Wall extends Rect {
  readonly floor: number;
}

// A gap on the wall line `at`: `axis` is the direction the wall runs ("x": the line z = at, gap x in [lo, hi]).
// `to` is the room on the other side, or "exterior" for the glass entrances and the penthouse door. A door
// onto a wall-less room (corridor, escalator) cuts no wall.
export interface Door {
  readonly floor: number;
  readonly roomId: string;
  readonly to: string;
  readonly axis: "x" | "z";
  readonly at: number;
  readonly lo: number;
  readonly hi: number;
}

export type AnchorKind =
  | "reception-desk"
  | "waiting-chair"
  | "ticker-wall"
  | "elevator-bank"
  | "stairwell";

export interface Anchor extends Rect {
  readonly kind: AnchorKind;
  readonly floor: number;
  readonly roomId: string;
}

export type Facing = "+x" | "-x" | "+z" | "-z";

// `facing` is the access side: the cluster edge that faces the room's door.
export interface DeskSlot extends Rect {
  readonly floor: number;
  readonly roomId: string;
  readonly facing: Facing;
}

export interface FloorLayout {
  readonly floor: number;
  readonly rooms: readonly RoomSpec[];
  readonly walls: readonly Wall[];
  readonly doors: readonly Door[];
  readonly anchors: readonly Anchor[];
  readonly deskSlots: readonly DeskSlot[];
  readonly deskCapacity: number;
}

export interface Entrance {
  readonly face: "+x" | "-x";
  readonly floor: number;
  // Position of the gap centre along the face (z), and its width.
  readonly centre: number;
  readonly width: number;
}

export interface Layout {
  readonly floors: number;
  readonly seed: number;
  // Index = floor, 0..floors-1 plus the roof (index `floors`, the penthouse only).
  readonly levels: readonly FloorLayout[];
  readonly openings: {
    readonly entrances: readonly Entrance[];
    readonly slabHole: Rect & { readonly floor: number };
  };
  // Floor-0 base and floor-1 landing are two zones of one escalator.
  readonly escalator: {
    readonly linkId: string;
    readonly baseId: string;
    readonly landingId: string;
  };
  readonly deskTotal: number;
}

export function deskCapacity(layout: Layout, floor: number): number {
  return layout.levels[floor]?.deskCapacity ?? 0;
}

const I = LOOK.interior;
const T = LOOK.tower;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const H = r1(GLASS_HALF);
const K = I.coreHalf;
const R = r1(K + I.corridorWidth);
// The ±z strips' middle span: corner rooms reach `cornerContact` past it into the ring's span.
const MID = r1(R - I.cornerContact);
const DOOR_MARGIN = 0.3;
// Desk clusters sit this far from the hull wall.
const DESK_INSET = I.wallThickness + 0.1;

// Plan view of floors 0 and 1 (x right, z down; K = coreHalf 7, R = K + corridorWidth 9.4, H = glass half 14.7, MID = R - cornerContact 7.4):
//
//    x=-H  -R   -K        K   R     H
// z=-H +-----+--+-+-------+-+--+-----+
//      |corn.|escalator 1.6 x 13.2|corn.|   -z strip, against the glass: end rooms plus the escalator;
//      |room +----------------+room |   floor 0: the right end room starts where the base ends;
// z=-R |     |  hall (corridor)      |   floor 1: the base area is the slab hole, the 1.6 m square
//      +--+--+-----------------+--+--+   landing sits beyond it, the hall runs the full MID span
//      |  |  | ring corridor 2.4 |  |  |
// z=-K |  |  +-----------------+ |  |  |   ring: four wall-less corridor pieces round the core
//      |P |  |   core 14 x 14  | |P |  |   core: open frame, one door per side onto the ring
//      |  |  |                 | |  |  |   P: perimeter band, rooms from R to H split along each side
// z=+K |  |  +-----------------+ |  |  |   floor 0: reception (+x) and waiting (-x) fill the ±x bands
//      +--+--+-----------------+--+--+
// z=+R |        +z strip rooms        |
// z=+H +-----------------------------+
//
// The rooms of a floor tile the glass hull exactly; the only gap is the floor-1 slab hole over the base.
type Side = "+z" | "+x" | "-z" | "-x";
type Mode = "split" | "none" | "escalator";

const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({
  min: [x0, z0],
  max: [x1, z1],
});

const LABELS: Record<RoomType, string> = {
  core: "Core",
  corridor: "Corridor",
  office: "Office",
  meeting: "Meeting room",
  restroom: "Restroom",
  reception: "Reception",
  waiting: "Waiting area",
  escalator: "Escalator",
  "break-room": "Break room",
  "server-room": "Server room",
};

// Ids are `<type>-<floor>-<index>` (index counts per type and floor in template order); the exceptions are
// `core-<floor>` and the tower-wide `break-room` and `server-room`.
function roomFactory(floor: number) {
  const counts = new Map<RoomType, number>();
  const parentId = floor === 0 ? "lobby" : `floor-${floor}`;
  return (roomType: RoomType, r: Rect, height?: number): RoomSpec => {
    const base = { roomType, floor, parentId, min: r.min, max: r.max };
    const sized = height === undefined ? base : { ...base, height };
    if (roomType === "core") return { ...sized, id: `core-${floor}`, name: `Core ${floor}` };
    if (roomType === "break-room" || roomType === "server-room") {
      return { ...sized, id: roomType, name: LABELS[roomType] };
    }
    const index = counts.get(roomType) ?? 0;
    counts.set(roomType, index + 1);
    return {
      ...sized,
      id: `${roomType}-${floor}-${index}`,
      name: `${LABELS[roomType]} ${floor}-${index}`,
    };
  };
}

type Factory = ReturnType<typeof roomFactory>;

// `n` widths of at least `minW` that fill [lo, hi]; returns the n + 1 edges on a 0.1 m grid.
function splitSpan(lo: number, hi: number, rng: () => number, minW: number): number[] {
  const length = r1(hi - lo);
  const fit = Math.max(1, Math.floor(length / minW + 1e-9));
  const n = fit > 1 && rng() < 0.5 ? fit - 1 : fit;
  const weights = Array.from({ length: n }, () => 0.5 + rng());
  const total = weights.reduce((a, b) => a + b, 0);
  const extra = length - n * minW;
  const edges = [lo];
  for (let i = 0; i < n - 1; i++) {
    const width = Math.floor((minW + (extra * weights[i]!) / total) * 10) / 10;
    edges.push(r1(edges[i]! + width));
  }
  edges.push(hi);
  return edges;
}

function stripRect(side: Side, lo: number, hi: number): Rect {
  if (side === "+z") return rect(lo, R, hi, H);
  if (side === "-z") return rect(lo, -H, hi, -R);
  if (side === "+x") return rect(R, lo, H, hi);
  return rect(-H, lo, -R, hi);
}

// In "escalator" mode the -z strip is cut at -MID and `escalatorEnd`: the span between is the escalator's.
function sideEdges(side: Side, mode: Mode, rng: () => number, escalatorEnd: number): number[] {
  if (mode === "none") return [];
  const alongX = side === "+z" || side === "-z";
  if (!alongX) return splitSpan(-R, R, rng, I.minOfficeWidth);
  if (mode === "escalator") return [-H, -MID, escalatorEnd, H];
  return [-H, ...splitSpan(-MID, MID, rng, I.minOfficeWidth), H];
}

// Perimeter room rectangles in template order: +z, +x, -z, -x, each ascending along its run. With "escalator"
// the middle of the side is left to the escalator and its hall, so only its two end rooms are made.
function perimeterRects(
  modes: Record<Side, Mode>,
  rng: () => number,
  escalatorEnd: number,
): Rect[] {
  const out: Rect[] = [];
  for (const side of ["+z", "+x", "-z", "-x"] as const) {
    const edges = sideEdges(side, modes[side], rng, escalatorEnd);
    const skipMiddle = modes[side] === "escalator";
    for (let i = 0; i + 1 < edges.length; i++) {
      if (skipMiddle && i === 1) continue;
      out.push(stripRect(side, edges[i]!, edges[i + 1]!));
    }
  }
  return out;
}

function weightedPick(rng: () => number, pool: readonly (readonly [RoomType, number])[]): RoomType {
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [type, w] of pool) {
    roll -= w;
    if (roll < 0) return type;
  }
  return pool[pool.length - 1]![0];
}

// Every `required` type lands on its own seeded slot; the rest are drawn from `pool`.
function assignTypes(
  count: number,
  rng: () => number,
  required: readonly RoomType[],
  pool: readonly (readonly [RoomType, number])[],
): RoomType[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const types = Array.from({ length: count }, () => weightedPick(rng, pool));
  required.forEach((type, i) => {
    types[order[i]!] = type;
  });
  return types;
}

function coreRooms(make: Factory): RoomSpec[] {
  return [
    make("core", rect(-K, -K, K, K)),
    make("corridor", rect(-R, K, R, R)),
    make("corridor", rect(K, -K, R, K)),
    make("corridor", rect(-R, -R, R, -K)),
    make("corridor", rect(-R, -K, -K, K)),
  ];
}

const isOpen = (type: RoomType) => type === "corridor" || type === "escalator";

// The edge two rects share (positive length), as the wall line it lies on.
function sharedEdge(
  a: Rect,
  b: Rect,
): { axis: "x" | "z"; at: number; lo: number; hi: number } | null {
  const zLo = Math.max(a.min[1], b.min[1]);
  const zHi = Math.min(a.max[1], b.max[1]);
  const xLo = Math.max(a.min[0], b.min[0]);
  const xHi = Math.min(a.max[0], b.max[0]);
  if (zLo < zHi) {
    if (a.max[0] === b.min[0]) return { axis: "z", at: a.max[0], lo: zLo, hi: zHi };
    if (b.max[0] === a.min[0]) return { axis: "z", at: a.min[0], lo: zLo, hi: zHi };
  }
  if (xLo < xHi) {
    if (a.max[1] === b.min[1]) return { axis: "x", at: a.max[1], lo: xLo, hi: xHi };
    if (b.max[1] === a.min[1]) return { axis: "x", at: a.min[1], lo: xLo, hi: xHi };
  }
  return null;
}

function doorAt(
  room: RoomSpec,
  to: string,
  edge: { axis: "x" | "z"; at: number; lo: number; hi: number },
): Door {
  const centre = r1((edge.lo + edge.hi) / 2);
  const half = I.doorWidth / 2;
  // A wall-less room has no corner to keep clear of, so it needs no margin.
  const needed = isOpen(room.roomType) ? I.doorWidth : I.doorWidth + 2 * DOOR_MARGIN;
  if (edge.hi - edge.lo < needed) {
    throw new ZoneError(
      `floor ${room.floor}: room "${room.id}" has ${r1(edge.hi - edge.lo)} m of wall shared with "${to}", ` +
        `less than the ${needed} m a door needs`,
    );
  }
  return {
    floor: room.floor,
    roomId: room.id,
    to,
    axis: edge.axis,
    at: edge.at,
    lo: r3(centre - half),
    hi: r3(centre + half),
  };
}

// Core: one door per side onto the ring. Every other room: one door onto the corridor it shares most wall with.
function roomDoors(rooms: readonly RoomSpec[]): Door[] {
  const corridors = rooms.filter((r) => r.roomType === "corridor");
  const doors: Door[] = [];
  for (const room of rooms) {
    if (room.roomType === "corridor") continue;
    const shared = corridors
      .map((c) => ({ c, edge: sharedEdge(room, c) }))
      .filter(
        (s): s is { c: RoomSpec; edge: NonNullable<ReturnType<typeof sharedEdge>> } =>
          s.edge !== null,
      );
    if (shared.length === 0) {
      throw new ZoneError(
        `floor ${room.floor}: room "${room.id}" touches no corridor, so it has no door`,
      );
    }
    if (room.roomType === "core") {
      for (const { c, edge } of shared) doors.push(doorAt(room, c.id, edge));
      continue;
    }
    const best = shared.reduce((a, b) => (b.edge.hi - b.edge.lo > a.edge.hi - a.edge.lo ? b : a));
    doors.push(doorAt(room, best.c.id, best.edge));
  }
  return doors;
}

function entranceDoor(room: RoomSpec, entrance: Entrance): Door {
  const at = entrance.face === "+x" ? H : -H;
  return {
    floor: room.floor,
    roomId: room.id,
    to: "exterior",
    axis: "z",
    at,
    lo: r3(entrance.centre - entrance.width / 2),
    hi: r3(entrance.centre + entrance.width / 2),
  };
}

interface Edge {
  readonly axis: "x" | "z";
  readonly at: number;
  readonly lo: number;
  readonly hi: number;
}

function roomEdges(r: Rect): Edge[] {
  return [
    { axis: "x", at: r.min[1], lo: r.min[0], hi: r.max[0] },
    { axis: "x", at: r.max[1], lo: r.min[0], hi: r.max[0] },
    { axis: "z", at: r.min[0], lo: r.min[1], hi: r.max[1] },
    { axis: "z", at: r.max[0], lo: r.min[1], hi: r.max[1] },
  ];
}

function wallRect(floor: number, axis: "x" | "z", centre: number, lo: number, hi: number): Wall {
  const h = I.wallThickness / 2;
  return axis === "x"
    ? { floor, min: [r3(lo), r3(centre - h)], max: [r3(hi), r3(centre + h)] }
    : { floor, min: [r3(centre - h), r3(lo)], max: [r3(centre + h), r3(hi)] };
}

// [lo, hi] minus every gap, as the pieces left.
function cutGaps(
  lo: number,
  hi: number,
  gaps: readonly (readonly [number, number])[],
): [number, number][] {
  let pieces: [number, number][] = [[lo, hi]];
  for (const [g0, g1] of gaps) {
    pieces = pieces.flatMap(([a, b]): [number, number][] => {
      if (g1 <= a || g0 >= b) return [[a, b]];
      const out: [number, number][] = [];
      if (g0 > a) out.push([a, g0]);
      if (g1 < b) out.push([g1, b]);
      return out;
    });
  }
  return pieces.filter(([a, b]) => b - a > 1e-6);
}

// One wall per boundary segment: lines are split at every room corner on them, shared boundaries give one
// wall, door gaps are cut once. Corridors and the escalator are wall-less. Hull faces that bound a room are
// the glass walls (`hull`), flush inside the glass line; the entrances are gaps in them.
function buildWalls(
  floor: number,
  rooms: readonly RoomSpec[],
  doors: readonly Door[],
  hull: boolean,
): Wall[] {
  const lines = new Map<string, Edge[]>();
  for (const room of rooms) {
    if (isOpen(room.roomType)) continue;
    for (const edge of roomEdges(room)) {
      if (hull && Math.abs(edge.at) === H) continue;
      const key = `${edge.axis}:${edge.at}`;
      lines.set(key, [...(lines.get(key) ?? []), edge]);
    }
  }
  const gapsOn = (axis: "x" | "z", at: number) =>
    doors.filter((d) => d.axis === axis && d.at === at).map((d): [number, number] => [d.lo, d.hi]);
  const walls: Wall[] = [];
  for (const edges of lines.values()) {
    const { axis, at } = edges[0]!;
    const points = [...new Set(edges.flatMap((e) => [e.lo, e.hi]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, b] = [points[i]!, points[i + 1]!];
      if (!edges.some((e) => e.lo <= a && e.hi >= b)) continue;
      for (const [lo, hi] of cutGaps(a, b, gapsOn(axis, at)))
        walls.push(wallRect(floor, axis, at, lo, hi));
    }
  }
  if (hull) {
    const t = I.wallThickness;
    for (const sign of [1, -1]) {
      for (const [axis, lo, hi] of [
        ["x", -H, H],
        ["z", -H + t, H - t],
      ] as const) {
        for (const [a, b] of cutGaps(lo, hi, gapsOn(axis, sign * H))) {
          walls.push(wallRect(floor, axis, sign * (H - t / 2), a, b));
        }
      }
    }
  }
  return walls;
}

const FACING_OF: Record<string, Facing> = {
  "x:min": "-z",
  "x:max": "+z",
  "z:min": "-x",
  "z:max": "+x",
};

// Clusters of 4 desks along the wall opposite the door, facing it. Each is at least `clearance` from the door.
function deskSlotsFor(room: RoomSpec, door: Door): DeskSlot[] {
  const alongX = door.axis === "x";
  const [runLo, runHi] = alongX ? [room.min[0], room.max[0]] : [room.min[1], room.max[1]];
  const doorAtMin = door.at === (alongX ? room.min[1] : room.min[0]);
  const facing = FACING_OF[`${door.axis}:${doorAtMin ? "min" : "max"}`]!;
  const n = Math.floor((runHi - runLo) / I.minOfficeWidth + 1e-9);
  if (n < 1) {
    throw new ZoneError(
      `floor ${room.floor}: office "${room.id}" is ${r1(runHi - runLo)} m wide, ` +
        `less than the ${I.minOfficeWidth} m minimum for a desk cluster`,
    );
  }
  const size = I.clusterSize;
  const far = alongX
    ? doorAtMin
      ? room.max[1] - DESK_INSET
      : room.min[1] + DESK_INSET
    : doorAtMin
      ? room.max[0] - DESK_INSET
      : room.min[0] + DESK_INSET;
  const [depthLo, depthHi] = doorAtMin ? [far - size, far] : [far, far + size];
  return Array.from({ length: n }, (_, i) => {
    const centre = runLo + ((i + 0.5) * (runHi - runLo)) / n;
    const [a, b] = [r3(centre - size / 2), r3(centre + size / 2)];
    const box = alongX
      ? rect(a, r3(depthLo), b, r3(depthHi))
      : rect(r3(depthLo), a, r3(depthHi), b);
    return { ...box, floor: room.floor, roomId: room.id, facing };
  });
}

function deskSlots(rooms: readonly RoomSpec[], doors: readonly Door[]): DeskSlot[] {
  return rooms
    .filter((r) => r.roomType === "office")
    .flatMap((room) =>
      deskSlotsFor(
        room,
        doors.find((d) => d.roomId === room.id)!,
      ),
    );
}

function coreAnchors(floor: number): Anchor[] {
  const id = `core-${floor}`;
  return [
    { kind: "elevator-bank", floor, roomId: id, ...rect(-3, -2, 3, 2) },
    { kind: "stairwell", floor, roomId: id, ...rect(4, 4, 6.5, 6.5) },
  ];
}

function finishFloor(
  floor: number,
  rooms: readonly RoomSpec[],
  extraDoors: readonly Door[],
  anchors: readonly Anchor[],
  hull: boolean,
): FloorLayout {
  const doors = [...roomDoors(rooms), ...extraDoors];
  const slots = deskSlots(rooms, doors);
  return {
    floor,
    rooms,
    walls: buildWalls(floor, rooms, doors, hull),
    doors,
    anchors,
    deskSlots: slots,
    deskCapacity: slots.length * 4,
  };
}

// The escalator run sits against the glass in the -z strip's middle (x -MID..MID with the landing); the hall
// between it and the ring is a wall-less corridor, so every m2 of the hull belongs to a room.
const ESC_X0 = -MID;
const ESC_X1 = r1(ESC_X0 + I.escalator.length);
const ESC_Z0 = -H;
const ESC_Z1 = r1(-H + I.escalator.width);

function escalatorRects(): { base: Rect; hole: Rect; landing: Rect; hall0: Rect; hall1: Rect } {
  const landingX1 = r1(ESC_X1 + I.escalator.width);
  if (landingX1 !== MID || ESC_Z1 >= -R) {
    throw new ZoneError(
      `floor 1: room "escalator-1-0" ends at x ${landingX1} m (z ${ESC_Z1} m), but must end at ${MID} m ` +
        `and leave a hall in front of the ring at ${-R} m`,
    );
  }
  const base = rect(ESC_X0, ESC_Z0, ESC_X1, ESC_Z1);
  return {
    base,
    hole: base,
    landing: rect(ESC_X1, ESC_Z0, landingX1, ESC_Z1),
    hall0: rect(ESC_X0, ESC_Z1, ESC_X1, -R),
    hall1: rect(ESC_X0, ESC_Z1, MID, -R),
  };
}

// The floor-0 entrance gap is centred in the mullion bay closest to the face centre.
function entranceCentre(): number {
  const n = Math.floor((2 * H) / T.mullionSpacing);
  const posts = [
    -H,
    ...Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * T.mullionSpacing),
    H,
  ];
  const centres = posts.slice(1).map((p, i) => (p + posts[i]!) / 2);
  return r3(centres.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)));
}

function lobbyAnchors(reception: RoomSpec, waiting: RoomSpec): Anchor[] {
  const desk = (cx: number, cz: number) =>
    rect(r3(cx - 0.4), r3(cz - 1.5), r3(cx + 0.4), r3(cz + 1.5));
  const chair = (cx: number, cz: number) =>
    rect(r3(cx - 0.3), r3(cz - 0.3), r3(cx + 0.3), r3(cz + 0.3));
  const chairs = [-6, -4, 4, 6].map((z): Anchor => ({
    kind: "waiting-chair",
    floor: 0,
    roomId: waiting.id,
    ...chair(-13.5, z),
  }));
  return [
    { kind: "reception-desk", floor: 0, roomId: reception.id, ...desk(12.6, 5) },
    ...chairs,
    { kind: "ticker-wall", floor: 0, roomId: reception.id, ...rect(10, -R + 0.05, 14, -R + 0.15) },
  ];
}

function layoutLobby(rng: () => number, entrances: readonly Entrance[]): FloorLayout {
  const make = roomFactory(0);
  const rooms: RoomSpec[] = coreRooms(make);
  const reception = make("reception", rect(R, -R, H, R));
  const waiting = make("waiting", rect(-H, -R, -R, R));
  rooms.push(reception, waiting);
  const rects = perimeterRects(
    { "+z": "split", "+x": "none", "-z": "escalator", "-x": "none" },
    rng,
    ESC_X1,
  );
  const types = assignTypes(
    rects.length,
    rng,
    ["restroom"],
    [
      ["meeting", 0.7],
      ["restroom", 0.3],
    ],
  );
  rects.forEach((r, i) => rooms.push(make(types[i]!, r)));
  const { base, hall0 } = escalatorRects();
  rooms.push(make("escalator", base), make("corridor", hall0));
  const doors = [entranceDoor(reception, entrances[0]!), entranceDoor(waiting, entrances[1]!)];
  return finishFloor(
    0,
    rooms,
    doors,
    [...coreAnchors(0), ...lobbyAnchors(reception, waiting)],
    true,
  );
}

// Rail walls along the slab-hole edges, so nothing routes into the hole: every edge except the landing end
// (hole max x) and the glass edge (the hull wall closes it), less what a room wall already covers.
function holeRails(floor: number, hole: Rect, walls: readonly Wall[]): Wall[] {
  const edges: Edge[] = [
    { axis: "x", at: hole.min[1], lo: hole.min[0], hi: hole.max[0] },
    { axis: "x", at: hole.max[1], lo: hole.min[0], hi: hole.max[0] },
    { axis: "z", at: hole.min[0], lo: hole.min[1], hi: hole.max[1] },
  ];
  return edges
    .filter((e) => Math.abs(e.at) !== H)
    .flatMap((e) => {
      const have = walls
        .filter((w) =>
          e.axis === "x"
            ? Math.abs((w.min[1] + w.max[1]) / 2 - e.at) < 1e-6 &&
              w.max[0] - w.min[0] > I.wallThickness
            : Math.abs((w.min[0] + w.max[0]) / 2 - e.at) < 1e-6 &&
              w.max[1] - w.min[1] > I.wallThickness,
        )
        .map((w): [number, number] =>
          e.axis === "x" ? [w.min[0], w.max[0]] : [w.min[1], w.max[1]],
        );
      return cutGaps(e.lo, e.hi, have).map(([lo, hi]) => wallRect(floor, e.axis, e.at, lo, hi));
    });
}

const OFFICE_POOL = [
  ["office", 0.6],
  ["meeting", 0.25],
  ["restroom", 0.15],
] as const;

// Floors 1..floors-1. Floor 1 also holds the break room and the escalator landing.
function layoutOffice(floor: number, rng: () => number): FloorLayout {
  const make = roomFactory(floor);
  const rooms: RoomSpec[] = coreRooms(make);
  const first = floor === 1;
  const rects = perimeterRects(
    { "+z": "split", "+x": "split", "-z": first ? "escalator" : "split", "-x": "split" },
    rng,
    MID,
  );
  const required: RoomType[] = [
    "office",
    "meeting",
    "restroom",
    ...(first ? (["break-room"] as const) : []),
  ];
  const types = assignTypes(rects.length, rng, required, OFFICE_POOL);
  rects.forEach((r, i) => rooms.push(make(types[i]!, r)));
  if (first) {
    const { landing, hall1 } = escalatorRects();
    rooms.push(make("escalator", landing), make("corridor", hall1));
  }
  const built = finishFloor(floor, rooms, [], coreAnchors(floor), true);
  const level = first
    ? { ...built, walls: [...built.walls, ...holeRails(floor, escalatorRects().hole, built.walls)] }
    : built;
  if (level.deskCapacity < 1) {
    throw new ZoneError(`floor ${floor}: no desk cluster fits, deskCapacity is 0`);
  }
  return level;
}

// The roof deck holds only the server penthouse, clear of the AC units (x -6.5..-3.5, z 3..5; x 6.3..9.9, z -4.7..-3.3)
// and the parapet (inner face at 14.7 m) by at least `clearance`.
function layoutRoof(floors: number): FloorLayout {
  const make = roomFactory(floors);
  const x0 = -2;
  const z0 = 5.5;
  const room: RoomSpec = {
    ...make(
      "server-room",
      rect(x0, z0, x0 + I.penthouse.x, z0 + I.penthouse.z),
      I.penthouse.height,
    ),
    parentId: "roof",
  };
  const door: Door = {
    floor: floors,
    roomId: room.id,
    to: "exterior",
    axis: "x",
    at: z0,
    lo: r3(x0 + I.penthouse.x / 2 - I.doorWidth / 2),
    hi: r3(x0 + I.penthouse.x / 2 + I.doorWidth / 2),
  };
  return {
    floor: floors,
    rooms: [room],
    walls: buildWalls(floors, [room], [door], false),
    doors: [door],
    anchors: [],
    deskSlots: [],
    deskCapacity: 0,
  };
}

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Floor k depends only on (seed, k), never on `floors`, so adding a floor leaves every lower floor unchanged.
export function buildLayout({ floors, seed }: { floors: number; seed: number }): Layout {
  if (!Number.isInteger(floors) || floors < 2) {
    throw new RangeError(`floors must be an integer of at least 2, got ${String(floors)}`);
  }
  const width = I.entranceWidth;
  const centre = entranceCentre();
  const entrances: Entrance[] = [
    { face: "+x", floor: 0, centre, width },
    { face: "-x", floor: 0, centre, width },
  ];
  const stream = (floor: number) => mulberry32(hashSeed(seed, floor));
  const levels: FloorLayout[] = [layoutLobby(stream(0), entrances)];
  for (let floor = 1; floor < floors; floor++) levels.push(layoutOffice(floor, stream(floor)));
  levels.push(layoutRoof(floors));
  const { hole } = escalatorRects();
  return deepFreeze({
    floors,
    seed,
    levels,
    openings: { entrances, slabHole: { floor: 1, ...hole } },
    escalator: { linkId: "escalator-0", baseId: "escalator-0-0", landingId: "escalator-1-0" },
    deskTotal: levels.reduce((sum, l) => sum + l.deskCapacity, 0),
  });
}
