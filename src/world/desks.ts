import { buildLayout, type Facing, type Layout } from "./layout";
import { fnv1a, hashSeed } from "./rng";
import { LOOK } from "./stage-look";
import { floorTopY } from "./tower";
import { MAX_FLOORS } from "./zones";

// Stream id for the per-floor desk variety draws (plants, tints), kept apart from the layout's own
// floor streams so floor layouts do not change.
export const DESK_STREAM = 0x4445534b;

// Seat offset from the cluster centre along the run (3.2 m cluster).
const SEAT_RUN = 0.8;
// Gap between a desk's near edge and its chair.
const CHAIR_GAP = 0.05;
// Seat (chair) offset across the depth: each desk's back edge is on the centre line, so the chair sits one desk
// depth, a gap and half a chair out; its outer edge (1.35 m) stays inside the 1.6 m slot edge.
export const SEAT_DEPTH = LOOK.interior.desk.top.depth + CHAIR_GAP + LOOK.interior.chair.size / 2;
// Beacon height above the floor top, over the seat.
const MOUNT_HEIGHT = 2.4;
const SEATS_PER_SLOT = 4;

export interface Seat {
  // Running index in `seatsOf` order; stable while floors are added on top.
  readonly index: number;
  readonly floor: number;
  readonly slot: number;
  readonly seat: 0 | 1 | 2 | 3;
  readonly x: number;
  readonly z: number;
  // The way the seated agent looks: across the cluster, toward the screen.
  readonly facing: Facing;
  // Beacon mount point [x, y, z] above the seat.
  readonly mount: readonly [number, number, number];
}

const opposite = (f: Facing): Facing => (f[0] === "+" ? `-${f[1]}` : `+${f[1]}`) as Facing;

// Every seat of the layout, ordered by floor, slot, then seat. Each cluster is a 2 x 2 pod: seats 0 and 1
// are on the door side (low run first), seats 2 and 3 on the far side.
export function seatsOf(layout: Layout): Seat[] {
  const seats: Seat[] = [];
  for (const level of layout.levels) {
    level.deskSlots.forEach((slot, slotIndex) => {
      const cx = (slot.min[0] + slot.max[0]) / 2;
      const cz = (slot.min[1] + slot.max[1]) / 2;
      const depthAlongZ = slot.facing[1] === "z";
      const doorSign = slot.facing[0] === "+" ? 1 : -1;
      for (let i = 0; i < SEATS_PER_SLOT; i++) {
        const doorSide = i < 2;
        const run = (i % 2 === 0 ? -1 : 1) * SEAT_RUN;
        const depth = (doorSide ? doorSign : -doorSign) * SEAT_DEPTH;
        const x = cx + (depthAlongZ ? run : depth);
        const z = cz + (depthAlongZ ? depth : run);
        seats.push({
          index: seats.length,
          floor: level.floor,
          slot: slotIndex,
          seat: i as Seat["seat"],
          x,
          z,
          facing: doorSide ? opposite(slot.facing) : slot.facing,
          mount: [x, floorTopY(level.floor) + MOUNT_HEIGHT, z],
        });
      }
    });
  }
  return seats;
}

export interface DeskAllocator {
  allocate(agentId: string, parentId?: string): Seat | null;
  release(agentId: string): void;
  deskOf(agentId: string): Seat | undefined;
  // Floor count the tower needs to seat everyone so far; never shrinks.
  readonly floorsNeeded: number;
  // Agents that found no seat at MAX_FLOORS.
  readonly unseated: number;
  // Seated agents whose seat is on a floor the renderer has not built (floor >= renderedFloors).
  offstage(renderedFloors: number): number;
}

// Deterministic desk assignment over arrival order, no stored state. Root agents fill the top office floor
// first: start at hash mod floorSeats and probe linearly, dropping a floor only when it is full. Subagents sit
// beside their parent. Adding a floor on top leaves lower floors, and so their seat indices, unchanged
// (layout.ts), so a grown seat list extends the old one. A layout change reassigns all desks.
export function createDeskAllocator({
  floors,
  seed,
}: {
  floors: number;
  seed: number;
}): DeskAllocator {
  if (!Number.isInteger(floors) || floors > MAX_FLOORS) {
    throw new RangeError(`floors must be an integer up to ${MAX_FLOORS}, got ${String(floors)}`);
  }
  const seatsByFloors = new Map<number, Seat[]>();
  const seatsFor = (n: number): Seat[] => {
    let seats = seatsByFloors.get(n);
    if (!seats) {
      seats = seatsOf(buildLayout({ floors: n, seed }));
      seatsByFloors.set(n, seats);
    }
    return seats;
  };

  let floorsNeeded = floors;
  let seats = seatsFor(floorsNeeded);
  // Seat range [start, start + count) of each floor within `seats`.
  let floorRange = new Map<number, { start: number; count: number }>();
  const indexFloors = () => {
    floorRange = new Map();
    for (const s of seats) {
      const range = floorRange.get(s.floor);
      if (range) range.count++;
      else floorRange.set(s.floor, { start: s.index, count: 1 });
    }
  };
  indexFloors();

  const agentSeat = new Map<string, Seat>();
  const seatAgent = new Map<number, string>();
  const unseatedIds = new Set<string>();
  let warned = false;

  const take = (id: string, seat: Seat): Seat => {
    agentSeat.set(id, seat);
    seatAgent.set(seat.index, id);
    return seat;
  };

  // Nearest free seat to `from` within [lo, hi), probing +1, -1, +2, -2, ...
  const nearestFree = (from: number, lo: number, hi: number): number | undefined => {
    for (let d = 0; d < hi - lo; d++) {
      for (const i of d === 0 ? [from] : [from + d, from - d]) {
        if (i >= lo && i < hi && !seatAgent.has(i)) return i;
      }
    }
    return undefined;
  };

  const rootSeat = (id: string): Seat | undefined => {
    const hash = hashSeed(seed, fnv1a(id));
    for (let f = floorsNeeded - 1; f >= 1; f--) {
      const range = floorRange.get(f);
      if (!range) continue;
      const first = hash % range.count;
      for (let p = 0; p < range.count; p++) {
        const index = range.start + ((first + p) % range.count);
        if (!seatAgent.has(index)) return seats[index];
      }
    }
    return undefined;
  };

  const childSeat = (parent: Seat): Seat | undefined => {
    const pod = parent.index - parent.seat;
    const inPod = nearestFree(parent.index, pod, pod + SEATS_PER_SLOT);
    if (inPod !== undefined) return seats[inPod];
    const range = floorRange.get(parent.floor)!;
    const onFloor = nearestFree(parent.index, range.start, range.start + range.count);
    return onFloor === undefined ? undefined : seats[onFloor];
  };

  return {
    allocate(agentId, parentId) {
      if (agentId === "") throw new RangeError("agentId must be a non-empty string");
      const existing = agentSeat.get(agentId);
      if (existing) return existing;
      const parent =
        parentId === undefined || parentId === agentId ? undefined : agentSeat.get(parentId);
      let seat = (parent && childSeat(parent)) || rootSeat(agentId);
      while (!seat && floorsNeeded < MAX_FLOORS) {
        floorsNeeded++;
        seats = seatsFor(floorsNeeded);
        indexFloors();
        seat = rootSeat(agentId);
      }
      if (!seat) {
        unseatedIds.add(agentId);
        if (!warned) {
          warned = true;
          console.warn(`desks: all seats on ${MAX_FLOORS} floors are taken; agents stay unseated`);
        }
        return null;
      }
      unseatedIds.delete(agentId);
      return take(agentId, seat);
    },
    release(agentId) {
      unseatedIds.delete(agentId);
      const seat = agentSeat.get(agentId);
      if (!seat) return;
      agentSeat.delete(agentId);
      seatAgent.delete(seat.index);
    },
    deskOf: (agentId) => agentSeat.get(agentId),
    get floorsNeeded() {
      return floorsNeeded;
    },
    get unseated() {
      return unseatedIds.size;
    },
    offstage(renderedFloors) {
      let n = 0;
      for (const seat of agentSeat.values()) if (seat.floor >= renderedFloors) n++;
      return n;
    },
  };
}
