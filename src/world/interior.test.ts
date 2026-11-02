import { Color, Matrix4 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { TOKENS } from "../shared/tokens";
import { GLASS_HALF } from "./dimensions";
import { INTERIOR_GEOMETRY_KINDS, buildInterior } from "./interior";
import { DESK_STREAM, seatsOf } from "./desks";
import { hashSeed, mulberry32 } from "./rng";
import { LAYOUT_SEED, ROOM_TYPES, buildLayout, type Rect, type Wall } from "./layout";
import { palette, materialBudgetCount, MATERIAL_BUDGET } from "./palette";
import { LOOK } from "./stage-look";
import { TOWER_PART_KINDS, buildTower, floorTopY, type TowerPart } from "./tower";
import { GLASS_RENDER_ORDER, Tower, partRenderOrder } from "./Tower.tsx";
import { FLOOR_HEIGHT } from "./zones";

const I = LOOK.interior;
const T = LOOK.tower;
const EPS = 1e-6;
const FLOORS = 6;
const layout = buildLayout({ floors: FLOORS, seed: LAYOUT_SEED });
const parts = buildInterior(layout);
const part = (kind: string): TowerPart => {
  const found = parts.find((p) => p.kind === kind);
  if (!found) throw new Error(`no ${kind} part`);
  return found;
};

interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}
// Axis-aligned box of one instance of a unit-box part.
const boxOf = (m: Matrix4): Box3 => {
  const e = m.elements;
  const half = [e[0]! / 2, e[5]! / 2, e[10]! / 2];
  const c = [e[12]!, e[13]!, e[14]!];
  return {
    min: [c[0]! - half[0]!, c[1]! - half[1]!, c[2]! - half[2]!],
    max: [c[0]! + half[0]!, c[1]! + half[1]!, c[2]! + half[2]!],
  };
};
const size = (b: Box3) => b.max.map((v, i) => v - b.min[i]!);
const centre = (b: Box3) => b.max.map((v, i) => (v + b.min[i]!) / 2);
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
// Tint vertices are float32: heights near 36 m carry about 4e-6 of rounding.
const nearF32 = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])) *
  Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]));
const rectOf = (b: Box3): Rect => ({ min: [b.min[0], b.min[2]], max: [b.max[0], b.max[2]] });
const slabHole = layout.openings.slabHole;

describe("buildInterior parts", () => {
  it("has unique kinds, all in the tower part union", () => {
    const kinds = parts.map((p) => p.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    const towerKinds = buildTower({ floors: FLOORS, openings: layout.openings }).parts.map(
      (p) => p.kind,
    );
    expect(new Set([...kinds, ...towerKinds]).size).toBe(kinds.length + towerKinds.length);
    for (const k of kinds) expect(TOWER_PART_KINDS as readonly string[]).toContain(k);
    expect(kinds.sort()).toEqual(
      [
        "chair",
        "coreFrame",
        "deskTop",
        "floorTint",
        "furniture",
        "lamp",
        "monitor",
        "partition",
        "penthouseGlass",
        "penthouseGlow",
        "penthouseRoof",
        "plant",
        "screen",
      ].sort(),
    );
  });

  it("casts and receives no shadow", () => {
    for (const p of parts) {
      expect([p.castShadow, p.receiveShadow], p.kind).toEqual([false, false]);
    }
  });

  it("lists the geometry kind of every part", () => {
    for (const p of parts) expect(INTERIOR_GEOMETRY_KINDS).toContain(p.geometryKey.kind);
  });

  it("adds no palette material and stays under the budget", () => {
    for (const p of parts) expect(Object.keys(palette)).toContain(p.material);
    expect(materialBudgetCount()).toBeLessThan(MATERIAL_BUDGET);
  });

  it("renders every glass-material part in the transparent pass", () => {
    const all = [...parts, ...buildTower({ floors: FLOORS, openings: layout.openings }).parts];
    for (const p of all) {
      expect(partRenderOrder(p), p.kind).toBe(p.material === "glass" ? GLASS_RENDER_ORDER : 0);
    }
    expect(part("penthouseGlass").material).toBe("glass");
    expect(all.some((p) => p.kind === "penthouseGlass")).toBe(true);
  });

  it("hides every glow part, the penthouse glow included, when the glow is off", () => {
    const all = [...parts, ...buildTower({ floors: FLOORS, openings: layout.openings }).parts];
    const kinds = (glow: boolean) => {
      const out = Tower({ parts: all, view: 0, glow, onUploaded: () => {} });
      return (out.props.children as { props: { part: TowerPart } }[]).map((e) => e.props.part.kind);
    };
    expect(kinds(true)).toContain("penthouseGlow");
    expect(kinds(false)).not.toContain("glow");
    expect(kinds(false)).not.toContain("glowHoled");
    expect(kinds(false)).not.toContain("penthouseGlow");
  });
});

describe("partitions", () => {
  const t = I.wallThickness;
  const isHull = (w: Wall) => {
    const thinX = w.max[0] - w.min[0] < w.max[1] - w.min[1];
    const [lo, hi] = thinX ? [w.min[0], w.max[0]] : [w.min[1], w.max[1]];
    return Math.max(Math.abs(lo), Math.abs(hi)) >= GLASS_HALF - EPS;
  };
  const touches = (w: Wall, k: number) =>
    w.min[1 - k]! <= slabHole.max[1 - k]! + EPS && w.max[1 - k]! >= slabHole.min[1 - k]! - EPS;
  // Walls over the hole slide to the walkable side, inner face on the hole edge.
  function railed(w: Wall): Rect {
    if (w.floor !== slabHole.floor) return w;
    const thinX = w.max[0] - w.min[0] < w.max[1] - w.min[1];
    const k = thinX ? 0 : 1;
    const [h0, h1] = [slabHole.min[k]!, slabHole.max[k]!];
    const c = (w.min[k]! + w.max[k]!) / 2;
    const onEdge = near(c, h0) || near(c, h1);
    if (overlapArea(w, slabHole) < EPS && !(onEdge && touches(w, k))) return w;
    const [lo, hi] = c < (h0 + h1) / 2 ? [h0 - t, h0] : [h1, h1 + t];
    return thinX
      ? { min: [lo, w.min[1]], max: [hi, w.max[1]] }
      : { min: [w.min[0], lo], max: [w.max[0], hi] };
  }
  const expected = layout.levels
    .slice(0, FLOORS)
    .flatMap((lv) => lv.walls.filter((w) => !isHull(w)).map(railed));
  const boxes = part("partition").matrices.map(boxOf);

  it("renders one partition per non-hull wall of the floors, 1.2 m tall from the slab top", () => {
    expect(I.partitionHeight).toBe(1.2);
    expect(boxes).toHaveLength(expected.length);
    const floorsOf = layout.levels
      .slice(0, FLOORS)
      .flatMap((lv) => lv.walls.filter((w) => !isHull(w)).map(() => lv.floor));
    boxes.forEach((b, i) => {
      const r = expected[i]!;
      expect(rectOf(b), `partition ${i}`).toEqual({
        min: [expect.closeTo(r.min[0], 9), expect.closeTo(r.min[1], 9)],
        max: [expect.closeTo(r.max[0], 9), expect.closeTo(r.max[1], 9)],
      });
      expect(b.min[1]).toBeCloseTo(floorTopY(floorsOf[i]!), 9);
      expect(b.max[1] - b.min[1]).toBeCloseTo(I.partitionHeight, 9);
    });
  });

  it("leaves walls far from the hole where the layout put them", () => {
    const far = layout.levels
      .slice(0, FLOORS)
      .flatMap((lv) => lv.walls.filter((w) => !isHull(w)))
      .filter(
        (w) =>
          w.floor === slabHole.floor &&
          (w.max[0] < slabHole.min[0] - 1 ||
            w.min[0] > slabHole.max[0] + 1 ||
            w.max[1] < slabHole.min[1] - 1 ||
            w.min[1] > slabHole.max[1] + 1),
      );
    expect(far.length).toBeGreaterThan(0);
    for (const w of far) {
      expect(
        boxes.some(
          (b) =>
            near(b.min[1], floorTopY(slabHole.floor)) &&
            near(b.min[0], w.min[0]) &&
            near(b.max[0], w.max[0]) &&
            near(b.min[2], w.min[1]) &&
            near(b.max[2], w.max[1]),
        ),
        `wall ${JSON.stringify(w)} unmoved`,
      ).toBe(true);
    }
  });

  it("has no sideways jog between partitions that meet on one wall line", () => {
    const thin = (b: Box3) => size(b)[0]! < size(b)[2]!;
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b || thin(a) !== thin(b) || !near(a.min[1], b.min[1])) continue;
        const k = thin(a) ? 0 : 2;
        // Along the line: walls with a door gap or a far run between them are not one run.
        const along = 2 - k;
        if (a.min[along]! > b.max[along]! + EPS || b.min[along]! > a.max[along]! + EPS) continue;
        const jog = Math.abs((a.min[k]! + a.max[k]!) / 2 - (b.min[k]! + b.max[k]!) / 2);
        expect(jog < EPS || jog > t - EPS, `jog ${jog} m`).toBe(true);
      }
    }
  });

  it("renders no hull wall (the glass is the hull)", () => {
    for (const b of boxes) {
      const flat = size(b)[0]! < size(b)[2]!;
      const outer = flat
        ? Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]))
        : Math.max(Math.abs(b.min[2]), Math.abs(b.max[2]));
      expect(outer).toBeLessThan(GLASS_HALF - EPS);
    }
  });

  it("keeps every floor-1 rail on the walkable side, flush with the hole edge, never over the void", () => {
    const y = floorTopY(slabHole.floor);
    const onFloor = boxes.filter((b) => near(b.min[1], y));
    for (const b of onFloor) expect(overlapArea(rectOf(b), slabHole)).toBeLessThan(EPS);
    const touching = onFloor.filter((b) => {
      const r = rectOf(b);
      return [
        near(r.min[1], slabHole.max[1]) && r.min[0] < slabHole.max[0],
        near(r.max[0], slabHole.min[0]),
      ].some(Boolean);
    });
    expect(touching.length).toBeGreaterThan(0);
  });

  it("orders instances by floor ascending", () => {
    const ys = boxes.map((b) => b.min[1]);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
});

describe("core frame", () => {
  const boxes = part("coreFrame").matrices.map(boxOf);
  const s = I.coreFrameSize;

  it("is open: every box is a 0.3 m post or a 0.3 m beam, nothing larger in two directions", () => {
    expect(s).toBe(0.3);
    for (const b of boxes) {
      expect(size(b).filter((v) => near(v, s)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("has a full-height post at each core corner and beside each core door, on every floor", () => {
    const posts = boxes.filter((b) => near(size(b)[1]!, FLOOR_HEIGHT));
    const has = (x: number, z: number, y: number) =>
      posts.some((b) => {
        const c = centre(b);
        return near(c[0]!, x) && near(c[2]!, z) && near(c[1]!, y);
      });
    for (let f = 0; f < FLOORS; f++) {
      const y = floorTopY(f) - T.slabThickness / 2 + FLOOR_HEIGHT / 2;
      const lv = layout.levels[f]!;
      const core = lv.rooms.find((r) => r.roomType === "core")!;
      for (const x of [core.min[0], core.max[0]]) {
        for (const z of [core.min[1], core.max[1]])
          expect(has(x, z, y), `corner ${x},${z}`).toBe(true);
      }
      const doors = lv.doors.filter((d) => d.roomId === core.id);
      expect(doors).toHaveLength(4);
      for (const d of doors) {
        for (const e of [d.lo - s / 2, d.hi + s / 2]) {
          const [x, z] = d.axis === "x" ? [e, d.at] : [d.at, e];
          expect(has(x, z, y), `jamb ${d.axis} ${d.at} ${e}`).toBe(true);
        }
      }
    }
    expect(posts).toHaveLength(FLOORS * 12);
  });

  it("has four 0.3 m beams under each slab, including the roof deck", () => {
    const beams = boxes.filter((b) => !near(size(b)[1]!, FLOOR_HEIGHT));
    expect(beams).toHaveLength(4 * FLOORS);
    for (let f = 1; f <= FLOORS; f++) {
      const under = floorTopY(f) - T.slabThickness;
      expect(beams.filter((b) => near(b.max[1], under))).toHaveLength(4);
    }
  });

  it("is the panel material", () => {
    expect(part("coreFrame").material).toBe("panel");
  });
});

describe("penthouse", () => {
  const level = layout.levels[FLOORS]!;
  const room = level.rooms[0]!;
  const roofY = floorTopY(FLOORS);
  const inRoom = (b: Box3, slack = 0) =>
    b.min[0] >= room.min[0] - slack - EPS &&
    b.max[0] <= room.max[0] + slack + EPS &&
    b.min[2] >= room.min[1] - slack - EPS &&
    b.max[2] <= room.max[1] + slack + EPS &&
    b.min[1] >= roofY - EPS &&
    b.max[1] <= roofY + I.penthouse.height + EPS;

  it("is 10 x 8 x 3.5 m", () => {
    expect([room.max[0] - room.min[0], room.max[1] - room.min[1], room.height]).toEqual([
      I.penthouse.x,
      I.penthouse.z,
      I.penthouse.height,
    ]);
    expect(I.penthouse).toMatchObject({ x: 10, z: 8, height: 3.5 });
  });

  it("keeps glass, roof and glow inside its room box and the roof on the glass", () => {
    const glass = part("penthouseGlass").matrices.map(boxOf);
    expect(glass).toHaveLength(level.walls.length);
    // Wall boxes are centred on the room edge, so they stick out by half a wall thickness.
    for (const b of glass) expect(inRoom(b, I.wallThickness / 2)).toBe(true);
    const roof = part("penthouseRoof").matrices.map(boxOf);
    expect(roof).toHaveLength(1);
    expect(inRoom(roof[0]!)).toBe(true);
    expect(roof[0]!.max[1]).toBeCloseTo(roofY + I.penthouse.height, 9);
    expect(roof[0]!.min[1]).toBeCloseTo(Math.max(...glass.map((b) => b.max[1])), 9);
    for (const b of part("penthouseGlow").matrices.map(boxOf)) {
      expect(inRoom(b)).toBe(true);
      expect(b.min[1]).toBeGreaterThanOrEqual(roofY + T.minGap);
    }
  });

  it("is at least 1 m clear of every AC box and the parapet", () => {
    const tower = buildTower({ floors: FLOORS, openings: layout.openings });
    const ac = tower.parts.find((p) => p.kind === "ac")!.matrices.map(boxOf);
    const roof = part("penthouseRoof").matrices.map(boxOf)[0]!;
    const gap = (a: Box3, b: Box3) =>
      Math.hypot(
        Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]),
        Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]),
      );
    for (const b of ac) expect(gap(roof, b)).toBeGreaterThanOrEqual(1 - EPS);
    const inner = 15 - T.parapetThickness;
    for (const v of [roof.min[0], roof.min[2]]) expect(v).toBeGreaterThanOrEqual(-inner + 1 - EPS);
    for (const v of [roof.max[0], roof.max[2]]) expect(v).toBeLessThanOrEqual(inner - 1 + EPS);
  });

  it("glows in trimWhite, cool white, not cyan", () => {
    expect(part("penthouseGlow").material).toBe("trimWhite");
    expect(part("penthouseRoof").material).toBe("panel");
  });

  it("leaves the door gap open in the glass", () => {
    const door = level.doors.find((d) => d.to === "exterior")!;
    const glass = part("penthouseGlass").matrices.map(boxOf);
    const across = door.axis === "z" ? 0 : 2;
    for (const b of glass) {
      const c = centre(b);
      const along = door.axis === "z" ? 2 : 0;
      const onLine = Math.abs(c[across]! - door.at) < I.wallThickness;
      if (onLine)
        expect(b.max[along]! <= door.lo + EPS || b.min[along]! >= door.hi - EPS).toBe(true);
    }
  });
});

describe("floor order", () => {
  it("interleaves core-frame posts and beams by floor, 4 beams under each floor's ceiling", () => {
    const frame = part("coreFrame");
    expect(frame.floorOf).toHaveLength(frame.matrices.length);
    for (let k = 0; k < FLOORS; k++) {
      const onFloor = frame.matrices.filter((_, i) => frame.floorOf[i] === k).map(boxOf);
      const beams = onFloor.filter((b) => near(size(b)[1]!, I.coreFrameSize));
      expect(beams, `floor ${k}`).toHaveLength(4);
      for (const b of beams) expect(centre(b)[1]!).toBeLessThan(floorTopY(k + 1) - T.slabThickness);
    }
    expect([...frame.floorOf]).toEqual([...frame.floorOf].sort((a, b) => a - b));
  });

  it("orders floor tints by floor", () => {
    const tint = part("floorTint");
    expect([...tint.floorOf]).toEqual([...tint.floorOf].sort((a, b) => a - b));
    expect(new Set(tint.floorOf)).toEqual(new Set(Array.from({ length: FLOORS + 1 }, (_, k) => k)));
  });
});

describe("floor tints", () => {
  it("has a TOKENS.room colour for exactly every room type", () => {
    expect(Object.keys(TOKENS.room).sort()).toEqual([...ROOM_TYPES].sort());
  });

  const tint = part("floorTint");
  // One instance per tinted room: a unit quad scaled to the room, its y the quad height, its colour the room's token.
  const quads = tint.matrices.map((m, i) => {
    const b = boxOf(m);
    return { rect: rectOf(b), y: centre(b)[1]!, flat: true, color: tint.colors![i]!.getHex() };
  });
  const tinted = layout.levels.flatMap((lv) => lv.rooms.filter((r) => r.roomType !== "corridor"));

  it("is one ground part of per-room quad instances with a colour each", () => {
    expect(tint.material).toBe("ground");
    expect(tint.matrices).toHaveLength(tinted.length);
    expect(tint.colors).toHaveLength(tinted.length);
    expect(tint.geometryKey.params).toEqual({});
    const geometry = tint.buildGeometry();
    expect(geometry.getAttribute("position").count).toBe(6);
    expect(geometry.getAttribute("normal").getY(0)).toBe(1);
  });

  it("has one quad per tinted room, in the room's token colour, lifted between minGap and glowLift", () => {
    expect(quads).toHaveLength(tinted.length);
    for (const room of tinted) {
      const y = floorTopY(room.floor) + T.minGap;
      const q = quads.find(
        (c) =>
          nearF32(c.rect.min[0], room.min[0]) &&
          nearF32(c.rect.min[1], room.min[1]) &&
          nearF32(c.rect.max[0], room.max[0]) &&
          nearF32(c.rect.max[1], room.max[1]) &&
          nearF32(c.y, y),
      );
      expect(q, `${room.id}`).toBeDefined();
      expect(q!.color, room.id).toBe(new Color(TOKENS.room[room.roomType]).getHex());
    }
    for (const q of quads) {
      expect(q.flat).toBe(true);
      const lift = q.y - floorTopY(Math.round(q.y / FLOOR_HEIGHT));
      expect(lift).toBeGreaterThanOrEqual(T.minGap - 1e-4);
      expect(lift).toBeLessThan(T.glowLift);
    }
  });

  it("leaves the floor-1 slab hole untinted", () => {
    const y = floorTopY(slabHole.floor) + T.minGap;
    for (const q of quads.filter((c) => nearF32(c.y, y))) {
      expect(overlapArea(q.rect, slabHole)).toBeLessThan(EPS);
    }
    expect(quads.some((q) => nearF32(q.y, floorTopY(0) + T.minGap))).toBe(true);
  });
});

describe("lobby furniture", () => {
  const furniture = part("furniture");
  const boxes = furniture.matrices.map(boxOf);
  const lobby = layout.levels[0]!;

  it("is the furniture material with one token colour per instance", () => {
    expect(furniture.material).toBe("furniture");
    expect(furniture.colors).toHaveLength(boxes.length);
  });

  it("puts a 3 x 0.8 x 1.1 m desk and 0.6 x 0.6 x 0.8 m chairs at their anchors", () => {
    const desks = lobby.anchors.filter((a) => a.kind === "reception-desk");
    const chairs = lobby.anchors.filter((a) => a.kind === "waiting-chair");
    expect(boxes).toHaveLength(desks.length + chairs.length);
    const base = floorTopY(0);
    const find = (a: Rect) =>
      boxes.findIndex(
        (b) =>
          near(centre(b)[0]!, (a.min[0] + a.max[0]) / 2) &&
          near(centre(b)[2]!, (a.min[1] + a.max[1]) / 2),
      );
    for (const a of desks) {
      const i = find(a);
      expect(i).toBeGreaterThanOrEqual(0);
      const [sx, sy, sz] = size(boxes[i]!);
      expect([sx, sz].sort((p, q) => p! - q!)).toEqual([
        expect.closeTo(I.receptionDesk.depth, 9),
        expect.closeTo(I.receptionDesk.length, 9),
      ]);
      expect(sy).toBeCloseTo(I.receptionDesk.height, 9);
      expect(boxes[i]!.min[1]).toBeGreaterThanOrEqual(base - EPS);
      expect(furniture.colors![i]!.getHex()).toBe(new Color(TOKENS.surface.furniture).getHex());
    }
    for (const a of chairs) {
      const i = find(a);
      expect(i).toBeGreaterThanOrEqual(0);
      const [sx, sy, sz] = size(boxes[i]!);
      expect([sx, sy, sz]).toEqual([
        expect.closeTo(I.chair.size, 9),
        expect.closeTo(I.chair.height, 9),
        expect.closeTo(I.chair.size, 9),
      ]);
      expect(furniture.colors![i]!.getHex()).toBe(new Color(TOKENS.surface.panel).getHex());
    }
  });
});

describe("desk kit parts", () => {
  const seats = seatsOf(layout);
  const D = I.desk;
  const seatKinds = ["deskTop", "chair", "monitor", "screen", "lamp"] as const;
  const luminance = (c: Color) => 0.2126729 * c.r + 0.7151522 * c.g + 0.072175 * c.b;

  it("has one instance per seat for every seat part, ordered by floor", () => {
    expect(seats.length).toBeGreaterThan(0);
    for (const k of seatKinds) {
      expect(part(k).matrices, k).toHaveLength(seats.length);
      expect(part(k).floorOf, k).toEqual(seats.map((s) => s.floor));
    }
  });

  it("places instance i at seat i (S1-1)", () => {
    part("deskTop").matrices.forEach((m, i) => {
      const c = centre(boxOf(m));
      expect(c[0]).toBeCloseTo(seats[i]!.x, 9);
      expect(c[2]).toBeCloseTo(seats[i]!.z, 9);
    });
    for (const k of seatKinds) {
      part(k).matrices.forEach((m, i) => {
        const c = centre(boxOf(m));
        // Chair and screen sit within one desk depth of the desk centre, on the seat's own floor.
        expect(Math.hypot(c[0]! - seats[i]!.x, c[2]! - seats[i]!.z), `${k} ${i}`).toBeLessThan(0.8);
      });
    }
  });

  it("sizes desk top, chair and lamp from LOOK", () => {
    part("deskTop").matrices.forEach((m, i) => {
      const [sx, sy, sz] = size(boxOf(m));
      const alongX = seats[i]!.facing[1] === "z";
      expect([alongX ? sx : sz, sy, alongX ? sz : sx]).toEqual([
        expect.closeTo(D.top.length, 9),
        expect.closeTo(D.top.height, 9),
        expect.closeTo(D.top.depth, 9),
      ]);
    });
    for (const m of part("chair").matrices) {
      expect(size(boxOf(m))).toEqual([
        expect.closeTo(I.chair.size, 9),
        expect.closeTo(I.chair.height, 9),
        expect.closeTo(I.chair.size, 9),
      ]);
    }
    for (const m of part("lamp").matrices) {
      const [sx, sy, sz] = size(boxOf(m));
      expect([sx, sy, sz]).toEqual([
        expect.closeTo(D.lamp.head, 9),
        expect.closeTo(D.lamp.height, 9),
        expect.closeTo(D.lamp.head, 9),
      ]);
    }
  });

  it("stands every seat part on its floor, and monitor, screen and lamp on the desk top", () => {
    for (const k of seatKinds) {
      part(k).matrices.forEach((m, i) => {
        const b = boxOf(m);
        const top = floorTopY(seats[i]!.floor);
        const onDesk = k === "monitor" || k === "screen" || k === "lamp";
        expect(b.min[1], `${k} ${i}`).toBeGreaterThanOrEqual(
          top + (onDesk ? D.top.height : 0) - EPS,
        );
      });
    }
  });

  it("puts the monitor stand and screen at the desk's inner edge, screen facing its chair", () => {
    part("screen").matrices.forEach((m, i) => {
      const b = boxOf(m);
      const [sx, sy, sz] = size(b);
      const s = seats[i]!;
      const axis = s.facing[1] === "x" ? 0 : 2;
      const sign = s.facing[0] === "+" ? 1 : -1;
      // The thin axis is the facing axis, so the face normal is horizontal: never downward.
      expect(axis === 0 ? sx : sz).toBeLessThan(0.05);
      expect(sy).toBeGreaterThan(0.2);
      const chair = centre(boxOf(part("chair").matrices[i]!));
      // The chair is behind the screen: a seated agent looks along the facing direction.
      expect((centre(b)[axis]! - chair[axis]!) * sign).toBeGreaterThan(0);
    });
  });

  it("uses the unlit screen and led materials and the furniture material elsewhere", () => {
    expect(part("screen").material).toBe("screen");
    expect(part("lamp").material).toBe("led");
    for (const k of ["deskTop", "chair", "monitor", "plant"]) {
      expect(part(k).material, k).toBe("furniture");
    }
    expect(materialBudgetCount()).toBeLessThan(MATERIAL_BUDGET);
  });

  it("colours chairs and plants by token and tints desk tops within 4% lightness", () => {
    const lightness = (c: Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l;
    const base = lightness(new Color(TOKENS.surface.furniture));
    for (const c of part("chair").colors!) {
      expect(c.getHex()).toBe(new Color(TOKENS.surface.chair).getHex());
    }
    for (const c of part("plant").colors!) {
      expect(c.getHex()).toBe(new Color(TOKENS.surface.plant).getHex());
    }
    const tops = part("deskTop").colors!;
    expect(tops).toHaveLength(seats.length);
    for (const c of tops)
      expect(Math.abs(lightness(c) / base - 1)).toBeLessThanOrEqual(0.04 + 1e-6);
    expect(new Set(tops.map((c) => c.getHex())).size).toBeGreaterThan(1);
  });

  it("colours screens by occupancy: idle teal when seated, off slate when empty", () => {
    const idle = new Color(TOKENS.surface.screenIdle).getHex();
    const off = new Color(TOKENS.surface.screenOff).getHex();
    for (const c of part("screen").colors!) expect(c.getHex()).toBe(off);
    const occupied = new Set([0, 5, seats.length - 1]);
    const lit = buildInterior(layout, occupied).find((p) => p.kind === "screen")!;
    lit.colors!.forEach((c, i) => expect(c.getHex(), `${i}`).toBe(occupied.has(i) ? idle : off));
  });

  it("lights every lamp the same warm colour, whether or not the desk is occupied", () => {
    const lit = buildInterior(layout, new Set([0])).find((p) => p.kind === "lamp")!;
    const dark = part("lamp").colors!;
    expect(dark).toHaveLength(seats.length);
    for (const c of [...dark, ...lit.colors!]) expect(c.getHex()).toBe(dark[0]!.getHex());
    const { r, g, b } = dark[0]!;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("keeps screen and lamp luminance below trimCyan, and the lamp at or below the tower glow", () => {
    const cyan = palette.trimCyan.emissiveIntensity * luminance(new Color(TOKENS.surface.trimCyan));
    const glow =
      palette.trimWhite.emissiveIntensity * luminance(new Color(TOKENS.surface.trimWhite));
    const lit = buildInterior(layout, new Set(seats.map((s) => s.index)));
    const idle = luminance(lit.find((p) => p.kind === "screen")!.colors![0]!);
    const lamp = luminance(part("lamp").colors![0]!);
    expect(idle).toBeLessThan(0.75 * cyan);
    expect(lamp).toBeLessThanOrEqual(glow);
    expect(lamp).toBeLessThan(cyan);
    expect(luminance(part("screen").colors![0]!)).toBeLessThan(idle);
  });

  it("puts one plant in about a third of the pods, on the floor, from the desk stream", () => {
    const pods: number[] = [];
    const seen = new Set<string>();
    for (const s of seats) {
      if (!seen.has(`${s.floor}:${s.slot}`)) {
        seen.add(`${s.floor}:${s.slot}`);
        pods.push(s.floor);
      }
    }
    // Re-draw the stream independently: one draw per pod in pod order, one stream per floor.
    const rngs = new Map<number, () => number>();
    const expected = pods.filter((floor) => {
      if (!rngs.has(floor)) rngs.set(floor, mulberry32(hashSeed(LAYOUT_SEED ^ DESK_STREAM, floor)));
      return rngs.get(floor)!() < D.plantRate;
    });
    const plants = part("plant");
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(pods.length);
    expect(plants.floorOf).toEqual(expected);
    expect(plants.colors).toHaveLength(expected.length);
    plants.matrices.forEach((m, i) => {
      const b = boxOf(m);
      expect(b.min[1]).toBeCloseTo(floorTopY(plants.floorOf[i]!), 9);
      expect(size(b)).toEqual([
        expect.closeTo(D.plant.width, 9),
        expect.closeTo(D.plant.height, 9),
        expect.closeTo(D.plant.width, 9),
      ]);
    });
  });

  it("leaves layouts unchanged: building the interior twice gives the same parts and layout", () => {
    const first = buildLayout({ floors: FLOORS, seed: LAYOUT_SEED });
    buildInterior(first);
    expect(first).toEqual(layout);
    const a = buildInterior(layout, new Set([1, 2]));
    const b = buildInterior(layout, new Set([1, 2]));
    expect(a.map((p) => p.matrices.map((m) => m.elements))).toEqual(
      b.map((p) => p.matrices.map((m) => m.elements)),
    );
  });
});
