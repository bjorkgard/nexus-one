import { describe, expect, it } from "vite-plus/test";
import { GLASS_HALF, TOWER_HALF, ZoneError } from "./dimensions";
import {
  LAYOUT_SEED,
  ROOM_TYPES,
  buildLayout,
  deskCapacity,
  type Door,
  type FloorLayout,
  type Layout,
  type Rect,
  type RoomSpec,
  type RoomType,
} from "./layout";
import { LOOK } from "./stage-look";
import { buildTower } from "./tower";
import { createZoneRegistry, validateZones } from "./zones";

const I = LOOK.interior;
const FLOOR_COUNTS = [2, 6, 40];
const EPS = 1e-6;
const RUN_INSET = 0.1;
const build = (floors: number, seed = LAYOUT_SEED) => buildLayout({ floors, seed });
const roomsOf = (layout: Layout) => layout.levels.flatMap((l) => l.rooms);
const ofType = (level: FloorLayout, type: RoomType) =>
  level.rooms.filter((r) => r.roomType === type);
const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.min[0] < b.max[0] + gap &&
  b.min[0] < a.max[0] + gap &&
  a.min[1] < b.max[1] + gap &&
  b.min[1] < a.max[1] + gap;
const inside = (inner: Rect, outer: Rect, tol = EPS) =>
  inner.min[0] >= outer.min[0] - tol &&
  inner.min[1] >= outer.min[1] - tol &&
  inner.max[0] <= outer.max[0] + tol &&
  inner.max[1] <= outer.max[1] + tol;
const HULL: Rect = { min: [-GLASS_HALF, -GLASS_HALF], max: [GLASS_HALF, GLASS_HALF] };
const doorRect = (d: Door): Rect =>
  d.axis === "x"
    ? { min: [d.lo, d.at], max: [d.hi, d.at] }
    : { min: [d.at, d.lo], max: [d.at, d.hi] };
// Euclidean distance between two boxes (0 when they touch or overlap).
const distance = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]),
    Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]),
  );

// A thin strip centred on the edge two rects share, kept a wall thickness clear of the ends so the walls of
// neighbouring rooms meeting at the corners do not count; null when they share no edge.
function sharedProbe(a: Rect, b: Rect, half: number): Rect | null {
  const xLo = Math.max(a.min[0], b.min[0]);
  const xHi = Math.min(a.max[0], b.max[0]);
  const zLo = Math.max(a.min[1], b.min[1]);
  const zHi = Math.min(a.max[1], b.max[1]);
  if (zLo < zHi - EPS && (a.max[0] === b.min[0] || b.max[0] === a.min[0])) {
    const at = a.max[0] === b.min[0] ? a.max[0] : a.min[0];
    return { min: [at - half, zLo + RUN_INSET], max: [at + half, zHi - RUN_INSET] };
  }
  if (xLo < xHi - EPS && (a.max[1] === b.min[1] || b.max[1] === a.min[1])) {
    const at = a.max[1] === b.min[1] ? a.max[1] : a.min[1];
    return { min: [xLo + RUN_INSET, at - half], max: [xHi - RUN_INSET, at + half] };
  }
  return null;
}

describe("buildLayout cores and rooms", () => {
  it.each(FLOOR_COUNTS)(
    "has core-N on floors 0..floors-1 and none on the roof (floors = %s)",
    (floors) => {
      const layout = build(floors);
      for (let k = 0; k < floors; k++) {
        expect(ofType(layout.levels[k]!, "core").map((r) => r.id)).toEqual([`core-${k}`]);
      }
      expect(ofType(layout.levels[floors]!, "core")).toEqual([]);
      expect(layout.levels).toHaveLength(floors + 1);
    },
  );

  it.each(FLOOR_COUNTS)(
    "passes validateZones and has no overlapping rooms (floors = %s)",
    (floors) => {
      const registry = createZoneRegistry({ floors });
      expect(() => validateZones(registry.zones)).not.toThrow();
      for (const level of build(floors).levels) {
        level.rooms.forEach((a, i) => {
          for (const b of level.rooms.slice(i + 1))
            expect(overlaps(a, b), `${a.id} / ${b.id}`).toBe(false);
        });
      }
    },
  );

  it.each(FLOOR_COUNTS)(
    "keeps rooms inside the glass hull except the penthouse (floors = %s)",
    (floors) => {
      const layout = build(floors);
      for (const level of layout.levels.slice(0, floors)) {
        for (const r of level.rooms) expect(inside(r, HULL), r.id).toBe(true);
        for (const w of level.walls)
          expect(inside(w, HULL), `wall on floor ${level.floor}`).toBe(true);
        for (const a of level.anchors) expect(inside(a, HULL), a.kind).toBe(true);
      }
    },
  );

  it.each(FLOOR_COUNTS)(
    "rooms fill the glass hull on floors 0..floors-1 except the floor-1 slab hole (floors = %s)",
    (floors) => {
      const layout = build(floors);
      const area = (r: Rect) => (r.max[0] - r.min[0]) * (r.max[1] - r.min[1]);
      for (const level of layout.levels.slice(0, floors)) {
        const roomArea = level.rooms.reduce((sum, r) => sum + area(r), 0);
        const hole =
          level.floor === layout.openings.slabHole.floor ? area(layout.openings.slabHole) : 0;
        expect(roomArea, `floor ${level.floor} room area`).toBeCloseTo(area(HULL) - hole, 6);
      }
    },
  );

  it("uses ids <type>-<floor>-<index> with the three documented exceptions", () => {
    const layout = build(6);
    const seen = new Set<string>();
    for (const r of roomsOf(layout)) {
      expect(seen.has(r.id), `duplicate ${r.id}`).toBe(false);
      seen.add(r.id);
      if (r.roomType === "core") expect(r.id).toBe(`core-${r.floor}`);
      else if (r.roomType === "break-room") expect(r.id).toBe("break-room");
      else if (r.roomType === "server-room") expect(r.id).toBe("server-room");
      else expect(r.id).toMatch(new RegExp(`^${r.roomType}-${r.floor}-\\d+$`));
    }
    expect(
      layout.levels[3]!.rooms.filter((r) => r.roomType === "corridor").map((r) => r.id),
    ).toEqual(["corridor-3-0", "corridor-3-1", "corridor-3-2", "corridor-3-3"]);
  });

  it("parents floor-0 rooms to lobby, floor-N rooms to floor-N and the penthouse to roof", () => {
    const layout = build(6);
    for (const r of roomsOf(layout)) {
      if (r.id === "server-room") expect(r.parentId).toBe("roof");
      else expect(r.parentId).toBe(r.floor === 0 ? "lobby" : `floor-${r.floor}`);
    }
  });

  it.each(FLOOR_COUNTS)("has all 10 room types somewhere in the tower (floors = %s)", (floors) => {
    const types = new Set(roomsOf(build(floors)).map((r) => r.roomType));
    expect([...types].sort()).toEqual([...ROOM_TYPES].sort());
  });

  it.each(FLOOR_COUNTS)("has the minimum rooms on every floor (floors = %s)", (floors) => {
    const layout = build(floors);
    const lobby = layout.levels[0]!;
    for (const type of ["restroom", "reception", "waiting", "escalator"] as const) {
      expect(ofType(lobby, type).length, `floor 0 ${type}`).toBeGreaterThanOrEqual(1);
    }
    expect(lobby.anchors.some((a) => a.kind === "ticker-wall")).toBe(true);
    for (let k = 1; k < floors; k++) {
      const level = layout.levels[k]!;
      for (const type of ["office", "meeting", "restroom"] as const) {
        expect(ofType(level, type).length, `floor ${k} ${type}`).toBeGreaterThanOrEqual(1);
      }
      expect(level.deskCapacity, `floor ${k} deskCapacity`).toBeGreaterThanOrEqual(1);
    }
  });

  it("puts the break room and escalator landing on floor 1 only", () => {
    const layout = build(6);
    expect(
      roomsOf(layout)
        .filter((r) => r.roomType === "break-room")
        .map((r) => r.floor),
    ).toEqual([1]);
    expect(
      roomsOf(layout)
        .filter((r) => r.roomType === "escalator")
        .map((r) => r.id),
    ).toEqual(["escalator-0-0", "escalator-1-0"]);
  });

  it("places core anchors on every floor 0..floors-1, inside the core room", () => {
    const layout = build(6);
    for (let k = 0; k < 6; k++) {
      const core = layout.levels[k]!.rooms.find((r) => r.roomType === "core")!;
      for (const kind of ["elevator-bank", "stairwell"] as const) {
        const anchor = layout.levels[k]!.anchors.find((a) => a.kind === kind);
        expect(anchor, `floor ${k} ${kind}`).toBeDefined();
        expect(inside(anchor!, core)).toBe(true);
      }
    }
    expect(layout.levels[6]!.anchors).toEqual([]);
  });

  it("places reception desk and waiting chairs inside reception and waiting", () => {
    const lobby = build(6).levels[0]!;
    const room = (id: string) => lobby.rooms.find((r) => r.id === id)!;
    const desk = lobby.anchors.find((a) => a.kind === "reception-desk")!;
    expect(inside(desk, room(desk.roomId))).toBe(true);
    expect(room(desk.roomId).roomType).toBe("reception");
    const chairs = lobby.anchors.filter((a) => a.kind === "waiting-chair");
    expect(chairs.length).toBeGreaterThanOrEqual(1);
    for (const c of chairs) {
      expect(room(c.roomId).roomType).toBe("waiting");
      expect(inside(c, room(c.roomId))).toBe(true);
    }
  });
});

describe("buildLayout determinism", () => {
  it("gives the same layout for the same seed", () => {
    expect(build(6)).toEqual(build(6));
  });

  it("gives different layouts for different seeds on at least one floor", () => {
    const a = build(6, 1);
    const b = build(6, 2);
    expect(a.levels.some((l, k) => JSON.stringify(l) !== JSON.stringify(b.levels[k]))).toBe(true);
  });

  it("leaves floors 0..5 and their desk slots identical at floors = 6 and 7", () => {
    const six = build(6);
    const seven = build(7);
    for (let k = 0; k < 6; k++) expect(seven.levels[k]).toEqual(six.levels[k]);
    expect(seven.levels[7]!.rooms[0]!.id).toBe("server-room");
  });

  it("is frozen all the way down", () => {
    const layout = build(3);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.levels[1]!.rooms[0]!.min)).toBe(true);
    expect(Object.isFrozen(layout.openings.entrances)).toBe(true);
  });

  it.each([1, 2.5, Number.NaN])("rejects floors = %s", (floors) => {
    expect(() => build(floors)).toThrow(RangeError);
  });

  it("keeps the registry layout equal to buildLayout with LAYOUT_SEED", () => {
    expect(createZoneRegistry({ floors: 6 }).layout).toEqual(build(6));
  });
});

describe("walls, doors and desk slots", () => {
  const layouts = FLOOR_COUNTS.map((f) => build(f));

  it("builds walls 0.1 m thick and doors 1.2 m wide (entrances and the penthouse door excepted)", () => {
    for (const layout of layouts) {
      for (const level of layout.levels) {
        for (const w of level.walls) {
          const thin = Math.min(w.max[0] - w.min[0], w.max[1] - w.min[1]);
          expect(thin).toBeCloseTo(I.wallThickness, 6);
        }
        for (const d of level.doors) {
          if (d.to === "exterior") continue;
          expect(d.hi - d.lo).toBeCloseTo(I.doorWidth, 6);
        }
      }
    }
  });

  it("lies every door gap on a boundary shared with a corridor, or on the hull for the entrances", () => {
    for (const layout of layouts) {
      for (const level of layout.levels) {
        const byId = new Map(level.rooms.map((r) => [r.id, r]));
        for (const d of level.doors) {
          const room = byId.get(d.roomId)!;
          expect(room, `door of ${d.roomId}`).toBeDefined();
          if (d.to === "exterior") {
            if (room.roomType === "server-room") continue;
            expect(Math.abs(d.at)).toBe(Math.round(GLASS_HALF * 10) / 10);
            continue;
          }
          const other = byId.get(d.to)!;
          expect(other.roomType).toBe("corridor");
          const g = doorRect(d);
          // The gap lies on both rooms' boundary lines.
          const line = d.axis === "x" ? 1 : 0;
          const run = d.axis === "x" ? 0 : 1;
          expect([room.min[line], room.max[line]]).toContain(d.at);
          expect([other.min[line], other.max[line]]).toContain(d.at);
          for (const r of [room, other]) {
            expect(g.min[run]).toBeGreaterThanOrEqual(r.min[run]! - EPS);
            expect(g.max[run]).toBeLessThanOrEqual(r.max[run]! + EPS);
          }
        }
      }
    }
  });

  it("gives every room except corridors at least one door", () => {
    for (const layout of layouts) {
      for (const level of layout.levels) {
        for (const r of level.rooms) {
          if (r.roomType === "corridor") continue;
          expect(level.doors.filter((d) => d.roomId === r.id).length, r.id).toBeGreaterThanOrEqual(
            1,
          );
        }
      }
    }
  });

  it("gives the core exactly one door per side", () => {
    const level = layouts[1]!.levels[2]!;
    const doors = level.doors.filter((d) => d.roomId === "core-2");
    expect(doors).toHaveLength(4);
    expect(new Set(doors.map((d) => `${d.axis}:${d.at}`)).size).toBe(4);
  });

  it("builds no wall inside a door gap and no wall between corridor rooms", () => {
    for (const level of layouts[1]!.levels) {
      for (const d of level.doors) {
        const gap = doorRect(d);
        const half = I.wallThickness / 2;
        const probe: Rect =
          d.axis === "x"
            ? { min: [d.lo + 0.01, d.at - half], max: [d.hi - 0.01, d.at + half] }
            : { min: [d.at - half, d.lo + 0.01], max: [d.at + half, d.hi - 0.01] };
        expect(gap).toBeDefined();
        for (const w of level.walls)
          expect(overlaps(w, probe, -EPS), `floor ${level.floor}`).toBe(false);
      }
      const corridors = level.rooms.filter((r) => r.roomType === "corridor");
      for (const c of corridors) {
        for (const w of level.walls) {
          const centre = { min: [(w.min[0] + w.max[0]) / 2, (w.min[1] + w.max[1]) / 2] } as const;
          const strictlyIn =
            centre.min[0] > c.min[0] + EPS &&
            centre.min[0] < c.max[0] - EPS &&
            centre.min[1] > c.min[1] + EPS &&
            centre.min[1] < c.max[1] - EPS;
          expect(strictlyIn, `wall inside ${c.id}`).toBe(false);
        }
      }
    }
  });

  it("builds one wall per boundary segment: no two walls overlap along a line", () => {
    for (const level of layouts[1]!.levels) {
      level.walls.forEach((a, i) => {
        for (const b of level.walls.slice(i + 1)) {
          const sameLine =
            (a.min[1] === b.min[1] && a.max[1] === b.max[1]) ||
            (a.min[0] === b.min[0] && a.max[0] === b.max[0]);
          if (!sameLine) continue;
          expect(overlaps(a, b, -EPS), `floor ${level.floor}`).toBe(false);
        }
      });
    }
  });

  it("builds no wall on an edge shared by two corridor rooms or by a corridor and the escalator", () => {
    const half = 0.01;
    for (const layout of layouts) {
      for (const level of layout.levels.slice(0, layout.floors)) {
        const open = level.rooms.filter(
          (r) => r.roomType === "corridor" || r.roomType === "escalator",
        );
        let pairs = 0;
        open.forEach((a, i) => {
          for (const b of open.slice(i + 1)) {
            if (a.roomType === "escalator" && b.roomType === "escalator") continue;
            const probe = sharedProbe(a, b, half);
            if (!probe) continue;
            pairs++;
            for (const w of level.walls)
              expect(overlaps(w, probe, -EPS), `floor ${level.floor}: ${a.id} / ${b.id}`).toBe(
                false,
              );
          }
        });
        expect(pairs, `floor ${level.floor} open-room seams`).toBeGreaterThanOrEqual(4);
        if (level.floor <= 1) {
          expect(
            open.some(
              (a) => a.roomType === "escalator" && open.some((b) => sharedProbe(a, b, half)),
            ),
            `floor ${level.floor} escalator seam`,
          ).toBe(true);
        }
      }
    }
  });

  it("closes each hull face with walls on every floor, open only at the floor-0 entrances", () => {
    const t = I.wallThickness;
    const H = Math.round(GLASS_HALF * 10) / 10;
    const covered = (level: FloorLayout, x: number, z: number) =>
      level.walls.some((w) => x > w.min[0] && x < w.max[0] && z > w.min[1] && z < w.max[1]);
    for (const layout of layouts) {
      for (const level of layout.levels.slice(0, layout.floors)) {
        const gaps = layout.openings.entrances.filter((e) => e.floor === level.floor);
        for (const [face, sign, alongX] of [
          ["+x", 1, false],
          ["-x", -1, false],
          ["+z", 1, true],
          ["-z", -1, true],
        ] as const) {
          const line = sign * (H - t / 2);
          for (let s = -H + 0.05; s < H; s += 0.1) {
            const inGap = gaps.some(
              (e) => e.face === face && Math.abs(s - e.centre) < e.width / 2 - EPS,
            );
            const hit = alongX ? covered(level, s, line) : covered(level, line, s);
            expect(hit, `floor ${level.floor} face ${face} at ${s.toFixed(2)}`).toBe(!inGap);
          }
        }
      }
    }
    expect(layouts[0]!.openings.entrances).toHaveLength(2);
  });

  it("keeps every desk slot inside its office, off every wall and 1 m from every door gap", () => {
    for (const layout of layouts) {
      for (const level of layout.levels) {
        const byId = new Map(level.rooms.map((r) => [r.id, r]));
        for (const s of level.deskSlots) {
          const room = byId.get(s.roomId)!;
          expect(room.roomType).toBe("office");
          expect(inside(s, room), s.roomId).toBe(true);
          expect(s.max[0] - s.min[0]).toBeCloseTo(I.clusterSize, 6);
          expect(s.max[1] - s.min[1]).toBeCloseTo(I.clusterSize, 6);
          for (const w of level.walls)
            expect(overlaps(s, w, -EPS), `${s.roomId} / wall`).toBe(false);
          for (const d of level.doors) {
            expect(distance(s, doorRect(d)), `${s.roomId} / door`).toBeGreaterThanOrEqual(
              I.clearance,
            );
          }
        }
      }
    }
  });

  it("never overlaps desk clusters and counts four desks per cluster", () => {
    for (const layout of layouts) {
      let total = 0;
      for (const level of layout.levels) {
        level.deskSlots.forEach((a, i) => {
          for (const b of level.deskSlots.slice(i + 1)) expect(overlaps(a, b, -EPS)).toBe(false);
        });
        expect(level.deskCapacity).toBe(level.deskSlots.length * 4);
        expect(deskCapacity(layout, level.floor)).toBe(level.deskCapacity);
        total += level.deskCapacity;
      }
      expect(layout.deskTotal).toBe(total);
    }
    expect(layouts[0]!.levels[0]!.deskCapacity).toBe(0);
  });
});

describe("walkable connectivity", () => {
  const STEP = 0.1;
  const N = Math.round((2 * GLASS_HALF) / STEP) + 1;
  const centre = (i: number) => -GLASS_HALF + i * STEP;

  type Mode = "half-open" | "open" | "closed";

  // Sets the cells of a 0.1 m grid whose centre lies in `r`; `modes` pick the edge rule per axis (x, z).
  function paint(grid: Uint8Array, r: Rect, value: number, modes: readonly [Mode, Mode]) {
    const range = (lo: number, hi: number, mode: Mode) => {
      const out: number[] = [];
      const first = Math.max(0, Math.floor((lo + GLASS_HALF) / STEP) - 1);
      const last = Math.min(N - 1, Math.ceil((hi + GLASS_HALF) / STEP) + 1);
      for (let i = first; i <= last; i++) {
        const c = centre(i);
        const ok =
          mode === "half-open"
            ? c >= lo - EPS && c < hi - EPS
            : mode === "open"
              ? c > lo + EPS && c < hi - EPS
              : c >= lo - EPS && c <= hi + EPS;
        if (ok) out.push(i);
      }
      return out;
    };
    for (const ix of range(r.min[0], r.max[0], modes[0])) {
      for (const iz of range(r.min[1], r.max[1], modes[1])) grid[iz * N + ix] = value;
    }
  }

  function walkable(level: FloorLayout) {
    const grid = new Uint8Array(N * N);
    for (const r of level.rooms) paint(grid, r, 1, ["half-open", "half-open"]);
    // A wall blocks strictly across its thickness and inclusively along its run, so corner cells are blocked too.
    for (const w of level.walls) {
      const thinX = w.max[0] - w.min[0] < w.max[1] - w.min[1];
      paint(grid, w, 0, thinX ? ["open", "closed"] : ["closed", "open"]);
    }
    for (const s of level.deskSlots) paint(grid, s, 0, ["open", "open"]);
    return grid;
  }

  function components(grid: Uint8Array): Int32Array {
    const label = new Int32Array(N * N).fill(-1);
    let next = 0;
    for (let start = 0; start < grid.length; start++) {
      if (!grid[start] || label[start] !== -1) continue;
      const stack = [start];
      label[start] = next;
      while (stack.length) {
        const cur = stack.pop()!;
        const x = cur % N;
        for (const n of [cur - 1, cur + 1, cur - N, cur + N]) {
          if (n < 0 || n >= grid.length) continue;
          if ((n === cur - 1 && x === 0) || (n === cur + 1 && x === N - 1)) continue;
          if (grid[n] && label[n] === -1) {
            label[n] = next;
            stack.push(n);
          }
        }
      }
      next++;
    }
    return label;
  }

  const cellOf = (x: number, z: number) =>
    Math.round((z + GLASS_HALF) / STEP) * N + Math.round((x + GLASS_HALF) / STEP);

  it.each(FLOOR_COUNTS)(
    "has one connected walkable region per floor and reachable desks (floors = %s)",
    (floors) => {
      const layout = build(floors);
      for (const level of layout.levels.slice(0, floors)) {
        const grid = walkable(level);
        const label = components(grid);
        const count = new Set(label.filter((l) => l >= 0)).size;
        expect(count, `floor ${level.floor} walkable regions`).toBe(1);
        for (const s of level.deskSlots) {
          const mid = [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2];
          const reach = I.clusterSize / 2 + 0.15;
          const point =
            s.facing === "+x"
              ? [mid[0]! + reach, mid[1]!]
              : s.facing === "-x"
                ? [mid[0]! - reach, mid[1]!]
                : s.facing === "+z"
                  ? [mid[0]!, mid[1]! + reach]
                  : [mid[0]!, mid[1]! - reach];
          expect(label[cellOf(point[0]!, point[1]!)], `${s.roomId} access side`).toBe(0);
        }
      }
    },
  );

  it("detects a sealed room: with an office door walled shut the floor is no longer connected", () => {
    const level = build(6).levels[2]!;
    const door = level.doors.find((d) => d.roomId.startsWith("office-2"))!;
    const shut: FloorLayout = {
      ...level,
      walls: [...level.walls, { floor: 2, ...doorWallRect(door) }],
    };
    expect(new Set(components(walkable(shut)).filter((l) => l >= 0)).size).toBeGreaterThan(1);
  });
});

function doorWallRect(d: Door): Rect {
  const h = I.wallThickness / 2;
  return d.axis === "x"
    ? { min: [d.lo, d.at - h], max: [d.hi, d.at + h] }
    : { min: [d.at - h, d.lo], max: [d.at + h, d.hi] };
}

describe("escalator pair and openings", () => {
  it.each(FLOOR_COUNTS)(
    "fits base, slab hole and landing with floor-1 rooms (floors = %s)",
    (floors) => {
      const layout = build(floors);
      const [floor0, floor1] = [layout.levels[0]!, layout.levels[1]!];
      const base = floor0.rooms.find((r) => r.id === layout.escalator.baseId)!;
      const landing = floor1.rooms.find((r) => r.id === layout.escalator.landingId)!;
      const hole = layout.openings.slabHole;
      expect(base.roomType).toBe("escalator");
      expect(landing.roomType).toBe("escalator");
      expect(base.floor).toBe(0);
      expect(landing.floor).toBe(1);
      expect(hole.floor).toBe(1);
      expect(base.max[0] - base.min[0]).toBeCloseTo(I.escalator.length, 6);
      expect(base.max[1] - base.min[1]).toBeCloseTo(I.escalator.width, 6);
      expect(hole.min).toEqual(base.min);
      expect(hole.max).toEqual(base.max);
      expect(landing.min[0]).toBeCloseTo(hole.max[0], 6);
      for (const r of [base, landing, hole]) expect(inside(r, HULL)).toBe(true);
      for (const room of floor1.rooms) {
        if (room === landing) continue;
        expect(overlaps(room, hole), `${room.id} / slab hole`).toBe(false);
        expect(overlaps(room, landing), `${room.id} / landing`).toBe(false);
      }
      for (const r of [base, landing]) {
        const doors = (r.floor === 0 ? floor0 : floor1).doors.filter((d) => d.roomId === r.id);
        expect(doors.length, `${r.id} doors`).toBeGreaterThanOrEqual(1);
      }
      expect(layout.escalator.linkId).toBe("escalator-0");
    },
  );

  it("cuts one entrance per glass face, centred in a mullion bay and narrower than the bay clear width", () => {
    const layout = build(6);
    const { entrances } = layout.openings;
    expect(entrances.map((e) => e.face).sort()).toEqual(["+x", "-x"]);
    const columns = buildTower({ floors: 6, openings: layout.openings }).parts.find(
      (p) => p.kind === "column",
    )!;
    for (const e of entrances) {
      const sign = e.face === "+x" ? 1 : -1;
      const posts = columns.matrices
        .slice(0, columns.matrices.length / 6)
        .map((m) => [m.elements[12]!, m.elements[14]!] as const)
        .filter(([x]) => Math.abs(x - sign * GLASS_HALF) < 1e-6)
        .map(([, z]) => z)
        .sort((a, b) => a - b);
      const below = posts.filter((z) => z <= e.centre).at(-1)!;
      const above = posts.find((z) => z > e.centre)!;
      expect(e.centre).toBeCloseTo((below + above) / 2, 6);
      expect(e.width).toBeLessThan(above - below - LOOK.tower.columnSize);
      expect(e.floor).toBe(0);
    }
    const lobbyDoors = layout.levels[0]!.doors.filter((d) => d.to === "exterior");
    expect(lobbyDoors.map((d) => d.roomId).sort()).toEqual(["reception-0-0", "waiting-0-0"]);
  });
});

describe("slab-hole rails", () => {
  // Rail walls stand on the hole edge lines; the landing end (hole max x) stays open.
  const layouts = FLOOR_COUNTS.map((f) => build(f));
  const onLine = (w: Rect, axis: "x" | "z", at: number) =>
    axis === "x"
      ? Math.abs((w.min[1] + w.max[1]) / 2 - at) < EPS
      : Math.abs((w.min[0] + w.max[0]) / 2 - at) < EPS;
  // True when walls on that line cover the whole of [lo, hi].
  function covered(walls: readonly Rect[], axis: "x" | "z", at: number, lo: number, hi: number) {
    for (let s = lo + 0.05; s < hi; s += 0.1) {
      const hit = walls.some(
        (w) =>
          onLine(w, axis, at) &&
          (axis === "x" ? w.min[0] <= s && w.max[0] >= s : w.min[1] <= s && w.max[1] >= s),
      );
      if (!hit) return false;
    }
    return true;
  }

  it.each(FLOOR_COUNTS)(
    "walls every hole edge except the landing end and the glass edge, on the hole floor only (floors = %s)",
    (floors) => {
      const layout = build(floors);
      const { slabHole: hole } = layout.openings;
      const walls = layout.levels[hole.floor]!.walls;
      expect(
        covered(walls, "x", hole.max[1], hole.min[0], hole.max[0]),
        "edge facing the hall",
      ).toBe(true);
      expect(
        covered(walls, "z", hole.min[0], hole.min[1], hole.max[1]),
        "edge facing the end room",
      ).toBe(true);
      // The landing end is open, so the escalator can be reached.
      expect(covered(walls, "z", hole.max[0], hole.min[1], hole.max[1])).toBe(false);
      // The hole edge on the glass line is closed by the hull wall, not by a second rail.
      expect(walls.some((w) => w.min[1] < hole.min[1] - EPS && w.max[1] > hole.min[1] + EPS)).toBe(
        false,
      );
      for (const level of layout.levels) {
        if (level.floor === hole.floor) continue;
        expect(
          covered(level.walls, "x", hole.max[1], hole.min[0], hole.max[0]),
          `floor ${level.floor}`,
        ).toBe(false);
      }
    },
  );

  it("leaves no desk slot or door gap under a rail, and keeps every rail 0.1 m thick on the hole line", () => {
    for (const layout of layouts) {
      const { slabHole: hole } = layout.openings;
      const level = layout.levels[hole.floor]!;
      const rails = level.walls.filter(
        (w) =>
          onLine(w, "x", hole.max[1]) &&
          w.min[0] >= hole.min[0] - EPS &&
          w.max[0] <= hole.max[0] + EPS,
      );
      expect(rails.length).toBeGreaterThanOrEqual(1);
      for (const w of rails) {
        expect(w.max[1] - w.min[1]).toBeCloseTo(I.wallThickness, 6);
        for (const s of level.deskSlots) expect(overlaps(s, w, -EPS)).toBe(false);
        for (const d of level.doors) expect(overlaps(doorRect(d), w, -EPS), d.roomId).toBe(false);
      }
    }
  });
});

describe("rooftop server room", () => {
  it.each(FLOOR_COUNTS)(
    "is a penthouse on the roof clear of AC units and parapet (floors = %s)",
    (floors) => {
      const layout = build(floors);
      const room = layout.levels[floors]!.rooms.find((r) => r.id === "server-room")! as RoomSpec;
      expect(layout.levels[floors]!.rooms).toHaveLength(1);
      expect(room.parentId).toBe("roof");
      expect(room.floor).toBe(floors);
      expect(room.max[0] - room.min[0]).toBeCloseTo(I.penthouse.x, 6);
      expect(room.max[1] - room.min[1]).toBeCloseTo(I.penthouse.z, 6);
      expect(room.height).toBe(I.penthouse.height);
      const ac = buildTower({ floors, openings: layout.openings }).parts.find(
        (p) => p.kind === "ac",
      )!;
      for (const m of ac.matrices) {
        const [sx, sz] = [m.elements[0]!, m.elements[10]!];
        const box: Rect = {
          min: [m.elements[12]! - sx / 2, m.elements[14]! - sz / 2],
          max: [m.elements[12]! + sx / 2, m.elements[14]! + sz / 2],
        };
        expect(distance(room, box)).toBeGreaterThanOrEqual(I.clearance - EPS);
      }
      const parapetInner = TOWER_HALF - LOOK.tower.parapetThickness;
      for (const v of [...room.min, ...room.max]) {
        expect(parapetInner - Math.abs(v)).toBeGreaterThanOrEqual(I.clearance - EPS);
      }
    },
  );

  it("registers the server room as a RoomZone on the roof band, 3.5 m tall", () => {
    const registry = createZoneRegistry({ floors: 6 });
    const z = registry.byId("server-room")!;
    expect(z.parentId).toBe("roof");
    expect(z.box.max[1] - z.box.min[1]).toBe(I.penthouse.height);
    expect(z.box.min[1]).toBe(registry.byId("roof")!.box.min[1]);
  });
});

describe("named errors", () => {
  it("names the floor, both ids and the rule when validateZones finds overlapping rooms", () => {
    const zones = [...createZoneRegistry({ floors: 3 }).zones];
    const twin = zones.find((z) => z.id === "office-2-0" || z.id.startsWith("office-2"))!;
    zones.push({ ...twin, id: "planted-twin" });
    const message = errorOf(() => validateZones(zones));
    expect(message).toContain("floor 2");
    expect(message).toContain(`"${twin.id}"`);
    expect(message).toContain('"planted-twin"');
    expect(message).toMatch(/overlap/);
  });

  it("names the floor, room and rule when a door cannot fit", () => {
    const original = I.doorWidth;
    (I as { doorWidth: number }).doorWidth = 20;
    try {
      const message = errorOf(() => build(3));
      expect(message).toMatch(/floor \d+/);
      expect(message).toMatch(/"[a-z-]+-\d+(-\d+)?"/);
      expect(message).toMatch(/door/);
    } finally {
      (I as { doorWidth: number }).doorWidth = original;
    }
  });

  // Coverage audit (ship, 2.4 floor layout).
  // Value: protects=a template change that shrinks offices below a cluster throws a ZoneError naming floor, office
  // and minimum, never zero desks; fails_when=the deskSlotsFor width guard is dropped or its message loses the
  // room; why_new=only the door-fit guard is tested; seam=none; no_claim=other template constants (mutated LOOK)
  it("names the floor, office and minimum when an office is narrower than a desk cluster", () => {
    const original = I.minOfficeWidth;
    (I as { minOfficeWidth: number }).minOfficeWidth = 50;
    try {
      const message = errorOf(() => build(3));
      expect(message).toMatch(/floor [12]/);
      expect(message).toMatch(/office "office-[12]-\d+"/);
      expect(message).toMatch(/less than the 50 m minimum/);
    } finally {
      (I as { minOfficeWidth: number }).minOfficeWidth = original;
    }
  });

  // Value: protects=an escalator size that no longer tiles the -z strip throws a ZoneError naming the landing and
  // where it must end; fails_when=the escalatorRects fit guard is dropped, leaving a gap or overlap by the landing;
  // why_new=no test changes the escalator size; seam=none; no_claim=a length change (read once at module load)
  it("names the landing and the required end when the escalator no longer tiles the strip", () => {
    const original = I.escalator.width;
    (I.escalator as { width: number }).width = original + 0.5;
    try {
      const message = errorOf(() => build(3));
      expect(message).toContain('"escalator-1-0"');
      expect(message).toMatch(/must end at 7\.4 m/);
    } finally {
      (I.escalator as { width: number }).width = original;
    }
  });
});

function errorOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ZoneError);
    return (err as ZoneError).message;
  }
  throw new Error("expected a ZoneError");
}
