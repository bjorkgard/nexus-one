import { Color, FrontSide, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { hexToLinear } from "../shared/color-metrics";
import { TOKENS } from "../shared/tokens";
import { fitZoom, framingBounds } from "./camera";
import { palette } from "./palette";
import { GLASS_HALF, ZoneError } from "./dimensions";
import { buildInterior } from "./interior";
import { LAYOUT_SEED, buildLayout, type Entrance } from "./layout";
import { LOOK } from "./stage-look";
import {
  TOWER_GEOMETRY_KINDS,
  TOWER_PART_KINDS,
  buildTower,
  cutCounts,
  floorTopY,
  type TowerPart,
  type TowerPartKind,
} from "./tower";
import { FLOOR_HEIGHT, MAX_FLOORS, MIN_FLOORS, assertFloors, createZoneRegistry } from "./zones";

const T = LOOK.tower;
const I = LOOK.interior;
const EPS = 1e-9;

// The openings come from the layout, never from the tower, so every expectation below is derived from them.
const openingsFor = (floors: number) => buildLayout({ floors, seed: LAYOUT_SEED }).openings;
const towerOf = (floors: number) => buildTower({ floors, openings: openingsFor(floors) });
const OPENINGS = openingsFor(6);
const gapOf = (e: Entrance): [number, number] => [e.centre - e.width / 2, e.centre + e.width / 2];
const faceNormal = (face: Entrance["face"]) => new Vector3(face === "+x" ? 1 : -1, 0, 0);

function part(floors: number, kind: TowerPartKind): TowerPart {
  const found = towerOf(floors).parts.find((p) => p.kind === kind);
  if (!found) throw new Error(`no ${kind} part`);
  return found;
}

// World-space triangles of one instance: [a, b, c] vertex triples.
function worldTriangles(p: TowerPart, matrix: Matrix4): Vector3[][] {
  const geometry = p.buildGeometry();
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const vertex = (i: number) =>
    new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
  const out: Vector3[][] = [];
  for (let i = 0; i < count; i += 3) out.push([vertex(i), vertex(i + 1), vertex(i + 2)]);
  return out;
}

const normalOf = ([a, b, c]: Vector3[]) =>
  new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!)).normalize();

describe("assertFloors", () => {
  it("accepts the range and rejects outside it, with one message for registry and tower", () => {
    expect(() => assertFloors(MIN_FLOORS)).not.toThrow();
    expect(() => assertFloors(MAX_FLOORS)).not.toThrow();
    for (const bad of [1, 41, 0, 2.5, Number.NaN]) {
      expect(() => assertFloors(bad)).toThrow(RangeError);
      expect(() => buildTower({ floors: bad, openings: OPENINGS })).toThrow(
        /floors must be an integer in \[2, 40\]/,
      );
      expect(() => createZoneRegistry({ floors: bad })).toThrow(
        /floors must be an integer in \[2, 40\]/,
      );
    }
    expect(() => buildTower({ floors: 1, openings: OPENINGS })).toThrow(
      "floors must be an integer in [2, 40], got 1",
    );
    expect(() => buildTower({ floors: 41, openings: OPENINGS })).toThrow("got 41");
  });
});

describe("buildTower counts", () => {
  it.each([2, 6, 40])("floors = %i: one slab, glass set, glow and column set per floor", (n) => {
    const { parts } = towerOf(n);
    const { entrances } = openingsFor(n);
    const count = (kind: TowerPartKind) => parts.filter((p) => p.kind === kind)[0]!.matrices.length;
    expect(parts.map((p) => p.kind).sort()).toEqual(
      [
        "ac",
        "column",
        "glass",
        "glow",
        "glowHoled",
        "parapet",
        "parapetEdge",
        "roofDeck",
        "slab",
        "slabHoled",
      ].sort(),
    );
    // The holed floor-1 slab is its own part, so the instanced slab loses one.
    expect(count("slab")).toBe(n - 1);
    expect(count("slabHoled")).toBe(1);
    // Each entrance gap splits one floor-0 plane in two: one extra instance per gap; a jamb pair frames each gap, in the column part.
    expect(count("glass")).toBe(["+x", "-x", "+z", "-z"].length * n + entrances.length);
    // The floor-1 glow ring is cut at the hole, so it is its own part like the slab.
    expect(count("glow")).toBe(n - 1);
    expect(count("glowHoled")).toBe(1);
    expect(count("column")).toBe(20 * n + 2 * entrances.length);
    expect(count("roofDeck")).toBe(1);
    expect(count("parapet")).toBe(4);
    expect(count("parapetEdge")).toBe(4);
    expect(count("ac")).toBe(3);
  });

  it("orders instances by floor ascending", () => {
    for (const kind of ["slab", "glow", "glass", "column"] as const) {
      const ys = part(6, kind).matrices.map((m) => m.elements[13]!);
      expect(ys, kind).toEqual([...ys].sort((a, b) => a - b));
    }
  });

  it("puts the roof deck on top of the last floor", () => {
    expect(part(6, "roofDeck").matrices[0]!.elements[13]).toBeCloseTo(floorTopY(6), 9);
  });
});

describe("glass", () => {
  const glass = part(6, "glass");
  const hullNormals = [
    new Vector3(1, 0, 0),
    new Vector3(-1, 0, 0),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  ];

  it("is a one-sided open plane per hull face: FrontSide, no top or bottom faces", () => {
    expect(palette.glass.side).toBe(FrontSide);
    const geometry = glass.buildGeometry();
    expect(geometry.getAttribute("position").count).toBe(4);
    const tris = worldTriangles(glass, new Matrix4());
    expect(tris).toHaveLength(2);
    for (const tri of tris) expect(Math.abs(normalOf(tri).y)).toBeLessThan(EPS);
  });

  it("has winding-derived world normals pointing away from the tower centre", () => {
    for (const m of glass.matrices) {
      expect(m.determinant()).toBeGreaterThan(0);
      for (const tri of worldTriangles(glass, m)) {
        const normal = normalOf(tri);
        const centre = tri[0]!.clone().add(tri[1]!).add(tri[2]!).divideScalar(3);
        centre.y = 0;
        expect(normal.dot(centre.normalize())).toBeGreaterThan(0.5);
      }
    }
  });

  it("has every instance coplanar with one of the four hull faces", () => {
    const faces = new Set<string>();
    for (const m of glass.matrices) {
      const tris = worldTriangles(glass, m);
      const normal = normalOf(tris[0]!);
      const face = hullNormals.find((h) => h.distanceTo(normal) < EPS);
      expect(face).toBeDefined();
      faces.add(`${face!.x},${face!.z}`);
      for (const tri of tris) {
        for (const v of tri) expect(Math.abs(v.dot(face!) - GLASS_HALF)).toBeLessThan(EPS);
      }
    }
    expect(faces.size).toBe(4);
  });

  it("has no negative-determinant matrix in any part", () => {
    for (const p of towerOf(6).parts) {
      for (const m of p.matrices) expect(m.determinant(), p.kind).toBeGreaterThan(0);
    }
  });

  // One glass plane: its face, floor-boundary heights and the extent along the face (z on the ±x faces, x on ±z).
  function planes(floors: number) {
    return part(floors, "glass").matrices.map((m) => {
      const face = hullNormals.find(
        (h) => new Vector3(0, 0, 1).transformDirection(m).distanceTo(h) < EPS,
      )!;
      const corners = [
        new Vector3(-0.5, -0.5, 0),
        new Vector3(0.5, -0.5, 0),
        new Vector3(0.5, 0.5, 0),
        new Vector3(-0.5, 0.5, 0),
      ].map((v) => v.applyMatrix4(m));
      const along = corners.map((c) => (face.x !== 0 ? c.z : c.x));
      return {
        face,
        corners,
        y0: m.elements[13]! - m.elements[5]! / 2,
        y1: m.elements[13]! + m.elements[5]! / 2,
        span: [Math.min(...along), Math.max(...along)] as [number, number],
      };
    });
  }
  const sameFace = (a: Vector3, e: Entrance) => a.distanceTo(faceNormal(e.face)) < EPS;

  // `a` minus `b`, as the intervals of `a` left over.
  function minus(a: [number, number][], b: [number, number][]) {
    let out = a;
    for (const [b0, b1] of b) {
      out = out.flatMap(([a0, a1]): [number, number][] => {
        if (b1 <= a0 || b0 >= a1) return [[a0, a1]];
        return [
          ...(b0 > a0 ? [[a0, b0] as [number, number]] : []),
          ...(b1 < a1 ? [[b1, a1] as [number, number]] : []),
        ];
      });
    }
    return out.filter(([x, y]) => y - x > EPS);
  }

  it("shares edges exactly between adjacent planes, with no overlap, except at the entrance gaps", () => {
    const floors = 6;
    const all = planes(floors);
    const key = (a: Vector3, b: Vector3) => {
      const f = (v: Vector3) => [v.x, v.y, v.z].map((n) => n.toFixed(6)).join(",");
      return [f(a), f(b)].sort().join("|");
    };
    // Vertical edges are matched bit for bit: the four corner lines per floor are shared by 2 planes; the two
    // jambs of every gap bound exactly one plane.
    const vertical = new Map<string, number>();
    for (const { corners: c } of all) {
      for (const [i, j] of [
        [1, 2],
        [3, 0],
      ] as const) {
        const k = key(c[i]!, c[j]!);
        vertical.set(k, (vertical.get(k) ?? 0) + 1);
      }
    }
    const counts = [...vertical.values()];
    expect(counts.filter((n) => n === 2)).toHaveLength(4 * floors);
    expect(counts.filter((n) => n === 1)).toHaveLength(2 * OPENINGS.entrances.length);
    expect(counts.every((n) => n <= 2)).toBe(true);
    for (const e of OPENINGS.entrances) {
      const x = (e.face === "+x" ? 1 : -1) * GLASS_HALF;
      for (const z of gapOf(e)) {
        const edge = key(
          new Vector3(x, floorTopY(e.floor), z),
          new Vector3(x, floorTopY(e.floor + 1), z),
        );
        expect(vertical.get(edge), `gap edge ${e.face} z=${z}`).toBe(1);
      }
    }
    // Horizontal edges on a floor line: the top segments of the floor below are disjoint and, with the gaps,
    // cover the bottom segments of the floor above exactly.
    for (const face of hullNormals) {
      const gaps = OPENINGS.entrances
        .filter((e) => sameFace(face, e))
        .map((e) => ({ floor: e.floor, gap: gapOf(e) }));
      for (let k = 1; k < floors; k++) {
        const here = all.filter((p) => p.face.equals(face));
        const below = here.filter((p) => Math.abs(p.y1 - floorTopY(k)) < EPS).map((p) => p.span);
        const above = here.filter((p) => Math.abs(p.y0 - floorTopY(k)) < EPS).map((p) => p.span);
        const sorted = [...below].sort((p, q) => p[0] - q[0]);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i]![0]).toBeGreaterThanOrEqual(sorted[i - 1]![1] - EPS);
        }
        const gap = gaps.filter((g) => g.floor === k - 1).map((g) => g.gap);
        const open = minus(above, below);
        expect(open, `${face.x},${face.z} floor line ${k}`).toHaveLength(gap.length);
        gap.forEach(([g0, g1], i) => {
          expect(open[i]![0]).toBeCloseTo(g0, 9);
          expect(open[i]![1]).toBeCloseTo(g1, 9);
        });
        expect(minus(below, above)).toEqual([]);
      }
    }
  });

  it("cuts the floor-0 glass around each entrance gap and leaves no glass inside it", () => {
    const all = planes(6);
    expect(OPENINGS.entrances.length).toBeGreaterThan(0);
    for (const e of OPENINGS.entrances) {
      const [g0, g1] = gapOf(e);
      const onFloor = all.filter(
        (p) => sameFace(p.face, e) && Math.abs(p.y0 - floorTopY(e.floor)) < EPS,
      );
      const pieces = onFloor.map((p) => p.span).sort((p, q) => p[0] - q[0]);
      expect(pieces).toHaveLength(2);
      expect(pieces[0]![0]).toBeCloseTo(-GLASS_HALF, 9);
      expect(pieces[0]![1]).toBeCloseTo(g0, 9);
      expect(pieces[1]![0]).toBeCloseTo(g1, 9);
      expect(pieces[1]![1]).toBeCloseTo(GLASS_HALF, 9);
      // No glass plane on this face and floor reaches into the open gap.
      for (const p of onFloor) {
        expect(Math.max(0, Math.min(p.span[1], g1) - Math.max(p.span[0], g0))).toBeLessThan(EPS);
      }
      // Each gap sits clear of the mullions beside it.
      const columns = part(6, "column").matrices.slice(0, 20);
      for (const m of columns) {
        const onFace = Math.abs(m.elements[12]! - (e.face === "+x" ? GLASS_HALF : -GLASS_HALF));
        if (onFace > EPS) continue;
        const z = m.elements[14]!;
        expect(z + T.columnSize / 2 <= g0 + EPS || z - T.columnSize / 2 >= g1 - EPS).toBe(true);
      }
    }
  });

  it("tiles each hull face top to bottom: floors meet without gap, pieces fill the width less the gaps", () => {
    const floors = 6;
    const all = planes(floors);
    for (const face of hullNormals) {
      const here = all.filter((p) => p.face.equals(face));
      const gaps = OPENINGS.entrances.filter((e) => sameFace(face, e));
      const levels = [...new Set(here.map((p) => p.y0.toFixed(6)))]
        .map(Number)
        .sort((a, b) => a - b);
      expect(levels).toHaveLength(floors);
      levels.forEach((y0, k) => {
        expect(y0).toBeCloseTo(floorTopY(k), 9);
        const row = here.filter((p) => Math.abs(p.y0 - y0) < EPS);
        for (const p of row) expect(p.y1).toBeCloseTo(floorTopY(k + 1), 9);
        const width = row.reduce((sum, p) => sum + p.span[1] - p.span[0], 0);
        const cut = gaps.filter((e) => e.floor === k).reduce((sum, e) => sum + e.width, 0);
        expect(width).toBeCloseTo(2 * GLASS_HALF - cut, 9);
        expect(row).toHaveLength(1 + gaps.filter((e) => e.floor === k).length);
      });
    }
  });
});

describe("z-fight gaps", () => {
  it("keeps glass clear of slab and column faces", () => {
    const slabHalf = GLASS_HALF + T.glassInset;
    expect(slabHalf - GLASS_HALF).toBeGreaterThanOrEqual(T.minGap);
    expect(T.columnSize / 2).toBeGreaterThanOrEqual(T.minGap);
    expect(slabHalf).toBe(15);
    // Columns are centred on the hull line, so the glass plane crosses them mid-body.
    for (const m of part(6, "column").matrices) {
      const x = Math.abs(m.elements[12]!);
      const z = Math.abs(m.elements[14]!);
      expect(Math.max(x, z)).toBeCloseTo(GLASS_HALF, 9);
    }
  });

  it("puts the glow above the floor top and inside the glass plane", () => {
    expect(T.glowLift).toBeGreaterThanOrEqual(T.minGap);
    expect(T.glowInset).toBeGreaterThanOrEqual(T.minGap);
    const glow = part(6, "glow");
    const floorsOf = [...Array(6).keys()].filter((k) => k !== OPENINGS.slabHole.floor);
    glow.matrices.forEach((m, i) => {
      expect(m.elements[13]! - floorTopY(floorsOf[i]!)).toBeGreaterThanOrEqual(T.minGap);
    });
    const position = glow.buildGeometry().getAttribute("position");
    let outer = 0;
    for (let i = 0; i < position.count; i++) {
      outer = Math.max(outer, Math.abs(position.getX(i)), Math.abs(position.getZ(i)));
    }
    // Positions are float32, so allow its rounding.
    expect(GLASS_HALF - outer).toBeGreaterThanOrEqual(T.glowInset - 1e-5);
  });

  it("puts the lobby slab top above the ground top and the grid", () => {
    const lobbyTop = part(6, "slab").matrices[0]!.elements[13]!;
    expect(lobbyTop - LOOK.gridLift).toBeGreaterThanOrEqual(T.minGap);
    expect(lobbyTop).toBeGreaterThanOrEqual(T.minGap);
  });

  it("keeps every offset at or above the z-fight gap", () => {
    for (const offset of [T.slabTopLift, T.glowLift, T.glassInset, T.glowInset]) {
      expect(offset).toBeGreaterThanOrEqual(T.minGap);
    }
    expect(T.slabTopLift - LOOK.gridLift).toBeGreaterThanOrEqual(T.minGap);
  });
});

describe("slab tops", () => {
  function topTriangles(p: TowerPart) {
    const geometry = p.buildGeometry();
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    const out: { centre: Vector3; colors: Color[] }[] = [];
    for (let i = 0; i < position.count; i += 3) {
      const verts = [0, 1, 2].map((j) => new Vector3().fromBufferAttribute(position, i + j));
      const normal = normalOf(verts);
      if (normal.y < 0.5) continue;
      expect(verts.every((v) => v.y === 0)).toBe(true);
      out.push({
        centre: verts[0]!.clone().add(verts[1]!).add(verts[2]!).divideScalar(3),
        colors: [0, 1, 2].map((j) => new Color().fromBufferAttribute(color, i + j)),
      });
    }
    return out;
  }
  const same = (a: Color, b: Color) => a.getHex() === b.getHex();

  it("colours the ring outside the glass line frame and the inside interiorTop, per triangle", () => {
    const ring = new Color(TOKENS.slab.frame);
    const inner = new Color(TOKENS.slab.interiorTop);
    const tops = topTriangles(part(6, "slab"));
    expect(tops.length).toBe(10);
    let innerCount = 0;
    let ringCount = 0;
    for (const { centre, colors } of tops) {
      expect(colors.every((c) => same(c, colors[0]!))).toBe(true);
      const inside = Math.max(Math.abs(centre.x), Math.abs(centre.z)) < GLASS_HALF;
      expect(same(colors[0]!, inside ? inner : ring)).toBe(true);
      if (inside) innerCount++;
      else ringCount++;
    }
    expect([innerCount, ringCount]).toEqual([2, 8]);
  });

  it("colours the sides and bottom frame", () => {
    const geometry = part(6, "slab").buildGeometry();
    const normal = geometry.getAttribute("normal");
    const color = geometry.getAttribute("color");
    const frame = new Color(TOKENS.slab.frame);
    for (let i = 0; i < normal.count; i++) {
      if (normal.getY(i) > 0.5) continue;
      expect(same(new Color().fromBufferAttribute(color, i), frame)).toBe(true);
    }
  });

  it("is 0.5 m thick and covers the footprint", () => {
    const geometry = part(6, "slab").buildGeometry();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-15, -T.slabThickness, -15]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([15, 0, 15]);
  });

  it("keys the slab geometry on both colours and the inset", () => {
    const key = part(6, "slab").geometryKey;
    expect(key.params).toMatchObject({
      outerTop: TOKENS.slab.frame,
      innerTop: TOKENS.slab.interiorTop,
      inset: T.glassInset,
    });
    expect(part(6, "slab").geometryKey).toEqual(part(40, "slab").geometryKey);
    expect(part(6, "roofDeck").geometryKey).not.toEqual(key);
  });

  it("makes the roof deck top one dark frame colour on every top triangle", () => {
    const panel = new Color(TOKENS.slab.frame);
    const tops = topTriangles(part(6, "roofDeck"));
    expect(tops.length).toBeGreaterThan(0);
    for (const { colors } of tops) for (const c of colors) expect(same(c, panel)).toBe(true);
  });
});

describe("holed glow", () => {
  const hole = OPENINGS.slabHole;
  const holed = part(6, "glowHoled");
  const [h0, h1] = [hole.min, hole.max];
  const tris = worldTriangles(holed, new Matrix4());
  const area = ([a, b, c]: Vector3[]) =>
    new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!)).length() / 2;
  const over = (half: number) =>
    Math.max(0, Math.min(h1[0], half) - Math.max(h0[0], -half)) *
    Math.max(0, Math.min(h1[1], half) - Math.max(h0[1], -half));
  const outer = GLASS_HALF - T.glowInset;
  const inner = outer - T.glowWidth;

  it("is one instance at the hole floor, keyed on the hole", () => {
    expect(holed.matrices).toHaveLength(1);
    expect(holed.matrices[0]!.elements[13]! - floorTopY(hole.floor)).toBeCloseTo(T.glowLift, 9);
    expect(holed.geometryKey.params).toMatchObject({
      holeMinX: h0[0],
      holeMinZ: h0[1],
      holeMaxX: h1[0],
      holeMaxZ: h1[1],
    });
    expect(TOWER_GEOMETRY_KINDS).toContain(holed.geometryKey.kind);
  });

  it("lights the ring except where it crosses the hole: no glow over the void", () => {
    const ring = 4 * (outer * outer - inner * inner);
    const cut = over(outer) - over(inner);
    expect(cut).toBeGreaterThan(0);
    const total = tris.reduce((sum, t) => sum + area(t), 0);
    expect(total).toBeCloseTo(ring - cut, 3);
    for (const t of tris) {
      const up = new Vector3()
        .subVectors(t[1]!, t[0]!)
        .cross(new Vector3().subVectors(t[2]!, t[0]!));
      expect(up.y).toBeGreaterThan(0);
      const c = t[0]!.clone().add(t[1]!).add(t[2]!).divideScalar(3);
      const inside = c.x > h0[0] && c.x < h1[0] && c.z > h0[1] && c.z < h1[1];
      expect(inside, `triangle at ${c.x}, ${c.z}`).toBe(false);
    }
  });
});

describe("holed slab", () => {
  const hole = OPENINGS.slabHole;
  const holed = part(6, "slabHoled");
  const [h0, h1] = [hole.min, hole.max];
  const holeArea = (h1[0] - h0[0]) * (h1[1] - h0[1]);
  const inHole = (x: number, z: number, tol = 0) =>
    x >= h0[0] - tol && x <= h1[0] + tol && z >= h0[1] - tol && z <= h1[1] + tol;
  const tris = () => worldTriangles(holed, new Matrix4());
  // Positions are float32, so areas hold to about 1e-3.
  const area = ([a, b, c]: Vector3[]) =>
    new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!)).length() / 2;
  const centreOf = (t: Vector3[]) => t[0]!.clone().add(t[1]!).add(t[2]!).divideScalar(3);

  it("is one instance at the hole floor's top, drawn like the other slabs", () => {
    expect(holed.matrices).toHaveLength(1);
    expect(holed.matrices[0]!.elements[13]).toBeCloseTo(floorTopY(hole.floor), 9);
    expect([holed.material, holed.castShadow, holed.receiveShadow]).toEqual([
      "ground",
      true,
      false,
    ]);
    const slabs = part(6, "slab").matrices.map((m) => m.elements[13]!);
    expect(slabs).not.toContain(holed.matrices[0]!.elements[13]);
    expect(slabs).toHaveLength(5);
  });

  it("keys the geometry on the hole as well as the colours", () => {
    expect(holed.geometryKey.kind).toBe("tower-slab-hole");
    expect(holed.geometryKey.params).toMatchObject({
      outerTop: TOKENS.slab.frame,
      innerTop: TOKENS.slab.interiorTop,
      holeMinX: h0[0],
      holeMinZ: h0[1],
      holeMaxX: h1[0],
      holeMaxZ: h1[1],
    });
    const moved = buildTower({
      floors: 6,
      openings: { ...OPENINGS, slabHole: { ...hole, max: [h1[0] - 1, h1[1]] } },
    });
    const other = moved.parts.find((p) => p.kind === "slabHoled")!;
    expect(other.geometryKey).not.toEqual(holed.geometryKey);
    expect(holed.geometryKey).toEqual(part(40, "slabHoled").geometryKey);
  });

  it("covers the footprint and the thickness, with nothing over the hole", () => {
    const geometry = holed.buildGeometry();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-15, -T.slabThickness, -15]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([15, 0, 15]);
    let top = 0;
    let bottom = 0;
    for (const t of tris()) {
      const n = normalOf(t);
      const c = centreOf(t);
      if (n.y > 0.5) top += area(t);
      if (n.y < -0.5) bottom += area(t);
      if (Math.abs(n.y) > 0.5) expect(inHole(c.x, c.z), "face over the hole").toBe(false);
    }
    expect(top).toBeCloseTo(30 * 30 - holeArea, 3);
    expect(bottom).toBeCloseTo(30 * 30 - holeArea, 3);
  });

  it("colours the top triangles by the ring and inside rule, per triangle", () => {
    const ring = new Color(TOKENS.slab.frame);
    const inner = new Color(TOKENS.slab.interiorTop);
    const geometry = holed.buildGeometry();
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    let innerArea = 0;
    let ringArea = 0;
    for (let i = 0; i < position.count; i += 3) {
      const verts = [0, 1, 2].map((j) => new Vector3().fromBufferAttribute(position, i + j));
      if (normalOf(verts).y < 0.5) continue;
      const colors = [0, 1, 2].map((j) => new Color().fromBufferAttribute(color, i + j));
      expect(colors.every((c) => c.getHex() === colors[0]!.getHex())).toBe(true);
      const c = centreOf(verts);
      const inside = Math.max(Math.abs(c.x), Math.abs(c.z)) < GLASS_HALF;
      expect(colors[0]!.getHex()).toBe((inside ? inner : ring).getHex());
      if (inside) innerArea += area(verts);
      else ringArea += area(verts);
    }
    expect(innerArea).toBeCloseTo((2 * GLASS_HALF) ** 2 - holeArea, 3);
    expect(ringArea).toBeCloseTo(30 * 30 - (2 * GLASS_HALF) ** 2, 3);
  });

  it("has rim faces down the thickness on every side of the hole, facing into it", () => {
    const rim = tris().filter(
      (t) => Math.abs(normalOf(t).y) < EPS && t.every((v) => inHole(v.x, v.z, 1e-6)),
    );
    const geometry = holed.buildGeometry();
    const color = geometry.getAttribute("color");
    expect(rim.length).toBeGreaterThanOrEqual(8);
    const perimeter = 2 * (h1[0] - h0[0] + (h1[1] - h0[1]));
    expect(rim.reduce((sum, t) => sum + area(t), 0)).toBeCloseTo(perimeter * T.slabThickness, 6);
    const middle: [number, number] = [(h0[0] + h1[0]) / 2, (h0[1] + h1[1]) / 2];
    const sides = new Set<string>();
    for (const t of rim) {
      const n = normalOf(t);
      const c = centreOf(t);
      // The normal points from the rim toward the hole centre.
      expect(n.x * (middle[0] - c.x) + n.z * (middle[1] - c.z)).toBeGreaterThan(0);
      expect(Math.min(...t.map((v) => v.y))).toBeCloseTo(-T.slabThickness, 6);
      expect(Math.max(...t.map((v) => v.y))).toBeCloseTo(0, 6);
      sides.add(`${n.x},${n.z}`);
    }
    expect([...sides].sort()).toEqual(["-1,0", "0,-1", "0,1", "1,0"].sort());
    const frame = new Color(TOKENS.slab.frame);
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) {
      if (normal.getY(i) > 0.5) continue;
      expect(new Color().fromBufferAttribute(color, i).getHex()).toBe(frame.getHex());
    }
  });

  it("puts any rim face on the glass plane back to back with the glass, so FrontSide culls one", () => {
    const rim = tris().filter(
      (t) => Math.abs(normalOf(t).y) < EPS && t.every((v) => inHole(v.x, v.z, 1e-6)),
    );
    for (const t of rim) {
      const n = normalOf(t);
      const c = centreOf(t);
      for (const face of [
        new Vector3(1, 0, 0),
        new Vector3(-1, 0, 0),
        new Vector3(0, 0, 1),
        new Vector3(0, 0, -1),
      ]) {
        if (Math.abs(c.dot(face) - GLASS_HALF) < T.minGap) expect(n.dot(face)).toBeLessThan(0);
      }
    }
  });

  it("rejects a hole that leaves the glass line or lies off the building", () => {
    const bad = (slabHole: typeof hole) =>
      buildTower({ floors: 6, openings: { ...OPENINGS, slabHole } });
    expect(() => bad({ ...hole, max: [GLASS_HALF + 1, h1[1]] })).toThrow(/slab hole/);
    expect(() => bad({ ...hole, floor: 6 })).toThrow(/slab hole/);
  });

  // Coverage audit (ship, 2.4 floor layout).
  // Value: protects=buildTower rejects a slab hole on the lobby, on a fractional floor or with no area;
  // fails_when=the floor >= 1 / integer / non-empty guard is dropped or off by one (hole on the lobby slab);
  // why_new=the test above covers only the glass-line and floor = floors rows; seam=none;
  // no_claim=none beyond protects
  it.each([
    ["the lobby (floor 0)", { floor: 0 }],
    ["a fractional floor", { floor: 1.5 }],
    ["zero width", { max: [hole.min[0], hole.max[1]] as const }],
    ["zero depth", { max: [hole.max[0], hole.min[1]] as const }],
  ])("rejects a hole on %s", (_label, patch) => {
    const slabHole = { ...hole, ...patch } as typeof hole;
    const make = () => buildTower({ floors: 6, openings: { ...OPENINGS, slabHole } });
    expect(make).toThrow(ZoneError);
    expect(make).toThrow(/slab hole/);
  });
});

describe("entrance portal frames", () => {
  const boxes = (kind: TowerPartKind) =>
    part(6, kind).matrices.map((m) => ({
      min: [
        m.elements[12]! - m.elements[0]! / 2,
        m.elements[13]! - m.elements[5]! / 2,
        m.elements[14]! - m.elements[10]! / 2,
      ],
      max: [
        m.elements[12]! + m.elements[0]! / 2,
        m.elements[13]! + m.elements[5]! / 2,
        m.elements[14]! + m.elements[10]! / 2,
      ],
    }));
  type Box3 = ReturnType<typeof boxes>[number];
  const jambs = () =>
    boxes("column").filter((b) => Math.abs(b.max[0]! - b.min[0]! - I.portalDepth) < EPS);

  it("puts two 0.3 m deep jambs beside each gap, in the frame colour, full height", () => {
    expect(I.portalDepth).toBe(0.3);
    // The jambs are the 0.3 m boxes of the column part.
    const found = jambs();
    for (const e of OPENINGS.entrances) {
      const sign = e.face === "+x" ? 1 : -1;
      const [g0, g1] = gapOf(e);
      const mine = found.filter(
        (b) => Math.abs((b.min[0]! + b.max[0]!) / 2 - sign * GLASS_HALF) < EPS,
      );
      expect(mine).toHaveLength(2);
      const jambs = mine.map((b) => [b.min[2]!, b.max[2]!]).sort((p, q) => p[0]! - q[0]!);
      expect(jambs[0]![1]).toBeCloseTo(g0, 9);
      expect(jambs[1]![0]).toBeCloseTo(g1, 9);
      for (const b of mine) {
        expect(b.max[0]! - b.min[0]!).toBeCloseTo(I.portalDepth, 9);
        expect(b.max[2]! - b.min[2]!).toBeCloseTo(I.portalDepth, 9);
        expect(b.min[1]!).toBeCloseTo(floorTopY(e.floor) - T.slabThickness / 2, 9);
        expect(b.max[1]! - b.min[1]!).toBeCloseTo(FLOOR_HEIGHT, 9);
      }
    }
  });

  // Two faces z-fight when they are parallel, closer than minGap and overlap in area.
  function conflicts(a: Box3, b: Box3): string[] {
    const out: string[] = [];
    for (let axis = 0; axis < 3; axis++) {
      const others = [0, 1, 2].filter((k) => k !== axis);
      const overlap = others.every(
        (k) => Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!) > EPS,
      );
      if (!overlap) continue;
      for (const x of [a.min[axis]!, a.max[axis]!]) {
        for (const y of [b.min[axis]!, b.max[axis]!]) {
          if (Math.abs(x - y) < T.minGap) out.push(`axis ${axis}: ${x} / ${y}`);
        }
      }
    }
    return out;
  }

  it("keeps every jamb face at least minGap from glass, column and slab faces", () => {
    const glassPlanes: Box3[] = part(6, "glass").matrices.map((m) => {
      const x = m.elements[12]!;
      const z = m.elements[14]!;
      const along = Math.abs(m.elements[0]!) + Math.abs(m.elements[2]!);
      const flatX = Math.abs(x) > Math.abs(z);
      const half = along / 2;
      const y = [m.elements[13]! - m.elements[5]! / 2, m.elements[13]! + m.elements[5]! / 2];
      return {
        min: [flatX ? x : x - half, y[0]!, flatX ? z - half : z],
        max: [flatX ? x : x + half, y[1]!, flatX ? z + half : z],
      };
    });
    const slabBoxes: Box3[] = Array.from({ length: 6 }, (_, k) => ({
      min: [-15, floorTopY(k) - T.slabThickness, -15],
      max: [15, floorTopY(k), 15],
    }));
    const columns = boxes("column");
    const isJamb = (b: Box3) => Math.abs(b.max[0]! - b.min[0]! - I.portalDepth) < EPS;
    const others = columns.filter((b) => !isJamb(b));
    for (const jamb of columns.filter(isJamb)) {
      for (const other of [...glassPlanes, ...others, ...slabBoxes]) {
        expect(conflicts(jamb, other)).toEqual([]);
      }
    }
  });

  it("throws ZoneError when an entrance overlaps a column or leaves its mullion bay", () => {
    const at = (centre: number, width = 3) => ({
      ...OPENINGS,
      entrances: [{ face: "+x" as const, floor: 0, centre, width }],
    });
    expect(() => buildTower({ floors: 6, openings: at(0) })).not.toThrow();
    // Column at z = 3 (mullion spacing 6).
    expect(() => buildTower({ floors: 6, openings: at(3) })).toThrow(ZoneError);
    // Fits no bay: wider than the 6 m bay less a column.
    expect(() => buildTower({ floors: 6, openings: at(0, 6) })).toThrow(ZoneError);
    // Hangs past the corner post.
    expect(() => buildTower({ floors: 6, openings: at(14) })).toThrow(ZoneError);
    // The gap itself fits the bay (1.1 +- 1.5 clears the column at z = 3), only its jamb reaches the column.
    expect(() => buildTower({ floors: 6, openings: at(1.1) })).toThrow(ZoneError);
  });
});

describe("parts: materials and shadows", () => {
  const table: Record<TowerPartKind, [string, boolean, boolean]> = {
    slab: ["ground", true, false],
    slabHoled: ["ground", true, false],
    column: ["ground", true, false],
    glass: ["glass", false, false],
    glow: ["trimWhite", false, false],
    glowHoled: ["trimWhite", false, false],
    roofDeck: ["ground", true, false],
    parapet: ["ground", true, false],
    parapetEdge: ["trimCyan", false, false],
    ac: ["ground", true, false],
    partition: ["panel", false, false],
    coreFrame: ["panel", false, false],
    floorTint: ["ground", false, false],
    furniture: ["furniture", false, false],
    penthouseGlass: ["glass", false, false],
    penthouseRoof: ["panel", false, false],
    penthouseGlow: ["trimWhite", false, false],
  };

  it("assigns material, cast and receive per part kind", () => {
    const layout = buildLayout({ floors: 6, seed: LAYOUT_SEED });
    for (const p of [...towerOf(6).parts, ...buildInterior(layout)]) {
      expect([p.material, p.castShadow, p.receiveShadow], p.kind).toEqual(table[p.kind]);
    }
  });

  it("uses four palette materials in the tower", () => {
    const names = new Set(towerOf(6).parts.map((p) => p.material));
    expect([...names].sort()).toEqual(["glass", "ground", "trimCyan", "trimWhite"].sort());
  });

  it("bakes the frame colour into the column (jambs included), parapet and AC boxes", () => {
    const frame = new Color(TOKENS.slab.frame);
    for (const kind of ["column", "parapet", "ac"] as const) {
      const p = part(6, kind);
      expect(p.geometryKey.params, kind).toMatchObject({ color: TOKENS.slab.frame });
      const color = p.buildGeometry().getAttribute("color");
      for (let i = 0; i < color.count; i++) {
        expect(new Color().fromBufferAttribute(color, i).getHex(), kind).toBe(frame.getHex());
      }
    }
  });

  it("keeps the cyan parapet bar at 0.25 x 0.06 m", () => {
    expect([T.parapetEdgeWidth, T.parapetEdgeHeight]).toEqual([0.25, 0.06]);
  });

  it("places the roof set on the roof deck", () => {
    const roofY = floorTopY(6);
    for (const kind of ["parapet", "parapetEdge", "ac"] as const) {
      for (const m of part(6, kind).matrices) expect(m.elements[13]!).toBeGreaterThan(roofY);
    }
  });
});

describe("AC units", () => {
  it("has unique, stable ids and roof-level positions", () => {
    const a = towerOf(6).acUnits;
    const b = towerOf(6).acUnits;
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((u) => u.id)).size).toBe(a.length);
    for (const u of a) {
      expect(u.name.length).toBeGreaterThan(0);
      expect(u.position[1]).toBeGreaterThan(floorTopY(6));
      expect(u.position[1]).toBeLessThan(floorTopY(6) + 2);
    }
    expect(towerOf(40).acUnits.map((u) => u.id)).toEqual(a.map((u) => u.id));
  });

  it("matches the matrices of the ac part", () => {
    const { parts, acUnits } = towerOf(6);
    const ac = parts.find((p) => p.kind === "ac")!;
    acUnits.forEach((u, i) => {
      const m = ac.matrices[i]!;
      expect([m.elements[12], m.elements[13], m.elements[14]]).toEqual([...u.position]);
    });
  });
});

describe("shell sizes", () => {
  it("follows the DZ6 starting sizes", () => {
    // Axis-aligned matrices: the scale is the diagonal.
    const sizes = (kind: TowerPartKind) =>
      part(6, kind).matrices.map((m) => [m.elements[0], m.elements[5], m.elements[10]]);
    expect(sizes("column")[0]).toEqual([T.columnSize, FLOOR_HEIGHT, T.columnSize]);
    const ac = sizes("ac");
    expect(ac[0]).toEqual([3, 1.4, 2]);
    expect(ac[1]).toEqual([1.4, 1, 1.4]);
    expect(ac[2]).toEqual([1.4, 1, 1.4]);
    expect(T.slabThickness).toBe(0.5);
    expect(T.glassInset).toBe(0.3);
    expect(T.parapetHeight).toBe(0.6);
    expect(T.glowWidth).toBe(0.4);
    expect(T.glowInset).toBe(0.15);
    expect(LOOK.key.shadow).toEqual({
      radius: 3,
      bias: -0.0005,
      normalBias: 0.02,
      mapSize: 2048,
    });
  });
});

describe("brightness ladder", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = hexToLinear(hex);
    return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  };

  it("keeps tower glow at most 75% of trimCyan in intensity x linear luminance", () => {
    const glow = palette.trimWhite.emissiveIntensity * luminance(TOKENS.surface.trimWhite);
    const cyan = palette.trimCyan.emissiveIntensity * luminance(TOKENS.surface.trimCyan);
    expect(glow).toBeLessThanOrEqual(0.75 * cyan);
    expect(glow).toBeGreaterThan(0);
  });
});

describe("penthouse glow", () => {
  const emissive = (name: keyof typeof palette) => {
    const m = palette[name];
    if (!("emissive" in m)) return 0;
    const { r, g, b } = m.emissive;
    return m.emissiveIntensity * (0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  };
  const interior = buildInterior(buildLayout({ floors: 6, seed: LAYOUT_SEED }));
  const penthouse = interior.find((p) => p.kind === "penthouseGlow")!;
  const tower = part(6, "glow");

  it("is at most the tower glow in intensity x linear luminance, and not cyan", () => {
    expect(emissive(penthouse.material)).toBeGreaterThan(0);
    expect(emissive(penthouse.material)).toBeLessThanOrEqual(emissive(tower.material));
    expect(emissive(penthouse.material)).toBeLessThanOrEqual(0.75 * emissive("trimCyan"));
    expect(penthouse.material).not.toBe("trimCyan");
  });
});

describe("glow strip visibility", () => {
  // Screen position of a ground (x, z) offset: right axis and up axis of the iso view.
  const project = (x: number, z: number) => [Math.SQRT1_2 * (x - z), (-1 / Math.sqrt(6)) * (x + z)];

  it("is at least 1.5 px wide perpendicular to its length at the default zoom of 2560x1440", () => {
    const zoom = fitZoom(framingBounds({ zonesOverlay: false }), { width: 2560, height: 1440 })!;
    const w = T.glowWidth;
    // The four glow sides: a strip along x or z, on both sides of the slab. The width is
    // measured across the projected strip: cross product over the projected length.
    for (const [along, across] of [
      [project(1, 0), project(0, w)],
      [project(-1, 0), project(0, w)],
      [project(0, 1), project(w, 0)],
      [project(0, -1), project(w, 0)],
    ] as const) {
      const cross = Math.abs(along[0]! * across[1]! - along[1]! * across[0]!);
      const perpendicular = (cross / Math.hypot(along[0]!, along[1]!)) * zoom;
      expect(perpendicular).toBeGreaterThanOrEqual(1.5);
    }
  });
});

describe("TOWER_GEOMETRY_KINDS", () => {
  it.each([2, 6, 40])("lists the geometry kind of every part at %i floors", (floors) => {
    const kinds: readonly string[] = TOWER_GEOMETRY_KINDS;
    for (const p of towerOf(floors).parts) expect(kinds).toContain(p.geometryKey.kind);
  });
});

describe("roof opening", () => {
  const floors = 6;
  const layout = buildLayout({ floors, seed: LAYOUT_SEED });
  const towerAt = (view?: number) =>
    buildTower({ floors, openings: layout.openings, ...(view === undefined ? {} : { view }) });
  const partOf = (t: ReturnType<typeof towerOf>, kind: TowerPartKind) =>
    t.parts.find((p) => p.kind === kind)!;
  const holeOf = (view: number) => {
    const p = partOf(towerAt(view), "roofDeck").geometryKey.params;
    return {
      min: [p.holeMinX as number, p.holeMinZ as number],
      max: [p.holeMaxX as number, p.holeMaxZ as number],
    };
  };
  // Footprints the hole must clear, from the layout's penthouse and the built AC boxes.
  const penthouse = layout.levels[floors]!.rooms[0]!;
  const acBoxes = () =>
    partOf(towerAt(), "ac").matrices.map((m) => ({
      min: [m.elements[12]! - m.elements[0]! / 2, m.elements[14]! - m.elements[10]! / 2],
      max: [m.elements[12]! + m.elements[0]! / 2, m.elements[14]! + m.elements[10]! / 2],
    }));
  type Box = { readonly min: readonly number[]; readonly max: readonly number[] };
  // Gap in metres between two rectangles (0 when they touch or overlap).
  const gap = (a: Box, b: Box) =>
    Math.hypot(
      Math.max(0, a.min[0]! - b.max[0]!, b.min[0]! - a.max[0]!),
      Math.max(0, a.min[1]! - b.max[1]!, b.min[1]! - a.max[1]!),
    );

  it.each([0, 1, 2, 3])("view %i: the hole clears the penthouse and every AC unit by 1 m", (v) => {
    const hole = holeOf(v);
    expect(gap(hole, penthouse)).toBeGreaterThanOrEqual(1);
    for (const b of acBoxes()) expect(gap(hole, b)).toBeGreaterThanOrEqual(1);
  });

  it.each([0, 1, 2, 3])(
    "view %i: the hole sits inside the parapet ring, in the camera's quadrant",
    (v) => {
      const hole = holeOf(v);
      const inner = 15 - T.parapetThickness;
      for (const c of [...hole.min, ...hole.max]) expect(Math.abs(c)).toBeLessThanOrEqual(inner);
      // Camera in +x,+z at view 0, then turning 90 degrees a step: (+,+), (+,-), (-,-), (-,+).
      const [sx, sz] = [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ][v]!;
      expect(hole.min[0]! * sx!).toBeGreaterThan(0);
      expect(hole.max[0]! * sx!).toBeGreaterThan(0);
      expect(hole.min[1]! * sz!).toBeGreaterThan(0);
      expect(hole.max[1]! * sz!).toBeGreaterThan(0);
    },
  );

  it.each([0, 1, 2, 3])("view %i: the roof geometry has no top face over the hole", (v) => {
    const deck = partOf(towerAt(v), "roofDeck");
    const hole = holeOf(v);
    const tops = worldTriangles(deck, deck.matrices[0]!).filter(
      (tri) => normalOf(tri).y > 0.5 && Math.abs(tri[0]!.y - floorTopY(floors)) < 1e-4,
    );
    expect(tops.length).toBeGreaterThan(0);
    for (const tri of tops) {
      const cx = (tri[0]!.x + tri[1]!.x + tri[2]!.x) / 3;
      const cz = (tri[0]!.z + tri[1]!.z + tri[2]!.z) / 3;
      const inside =
        cx > hole.min[0]! && cx < hole.max[0]! && cz > hole.min[1]! && cz < hole.max[1]!;
      expect(inside).toBe(false);
    }
  });

  it("keeps the parapet and cyan edge whole and identical at every view", () => {
    const base = towerAt(0);
    for (const v of [1, 2, 3]) {
      const t = towerAt(v);
      for (const kind of ["parapet", "parapetEdge"] as const) {
        expect(partOf(t, kind).matrices.map((m) => m.elements)).toEqual(
          partOf(base, kind).matrices.map((m) => m.elements),
        );
        expect(partOf(t, kind).matrices).toHaveLength(4);
      }
    }
  });

  it("changes only the roof deck between views: same kinds and instance counts", () => {
    const base = towerAt(0);
    expect(towerAt().parts.map((p) => p.geometryKey)).toEqual(base.parts.map((p) => p.geometryKey));
    for (const v of [1, 2, 3]) {
      const t = towerAt(v);
      expect(t.parts.map((p) => [p.kind, p.matrices.length])).toEqual(
        base.parts.map((p) => [p.kind, p.matrices.length]),
      );
      const changed = t.parts.filter(
        (p, i) => JSON.stringify(p.geometryKey) !== JSON.stringify(base.parts[i]!.geometryKey),
      );
      expect(changed.map((p) => p.kind)).toEqual(["roofDeck"]);
    }
  });

  it("rejects a view outside 0..3", () => {
    for (const v of [-1, 4, 0.5]) expect(() => towerAt(v)).toThrow(ZoneError);
  });
});

describe("cutCounts", () => {
  // Floor of an instance from its own height alone (independent of `floorOf`): slab tops sit `slabTopLift`
  // above k * FLOOR_HEIGHT, and every instance lies in the band above its slab or just below the next.
  const floorFromY = (m: Matrix4) =>
    Math.floor((m.elements[13]! - T.slabTopLift) / FLOOR_HEIGHT + 1e-6);
  const partsAt = (floors: number) => {
    const layout = buildLayout({ floors, seed: LAYOUT_SEED });
    return [...buildTower({ floors, openings: layout.openings }).parts, ...buildInterior(layout)];
  };

  it.each([2, 6, 12])(
    "matches the instances on floors <= k for every kind at %i floors",
    (floors) => {
      const parts = partsAt(floors);
      expect(new Set(parts.map((p) => p.kind))).toEqual(new Set(TOWER_PART_KINDS));
      for (const p of parts) {
        expect(p.floorOf, p.kind).toEqual(p.matrices.map(floorFromY));
        expect([...p.floorOf], p.kind).toEqual([...p.floorOf].sort((a, b) => a - b));
      }
      for (let k = 1; k <= floors; k++) {
        const counts = cutCounts(parts, k, floors);
        for (const p of parts) {
          expect(counts[p.kind], `${p.kind} at k=${k}`).toBe(
            p.matrices.filter((m) => floorFromY(m) <= k).length,
          );
        }
      }
    },
  );

  it("hides every roof-level kind below the top and shows all of them at k = floors", () => {
    const floors = 6;
    const parts = partsAt(floors);
    const roofLevel = [
      "roofDeck",
      "parapet",
      "parapetEdge",
      "ac",
      "penthouseGlass",
      "penthouseRoof",
      "penthouseGlow",
    ] as const;
    for (const k of [1, floors - 1]) {
      const counts = cutCounts(parts, k, floors);
      for (const kind of roofLevel) expect(counts[kind], kind).toBe(0);
    }
    const all = cutCounts(parts, floors, floors);
    for (const p of parts) expect(all[p.kind], p.kind).toBe(p.matrices.length);
  });

  it("makes the interleaved kinds exact: core frame and tints grow floor by floor", () => {
    const floors = 6;
    const parts = partsAt(floors);
    for (const kind of ["coreFrame", "floorTint", "column", "partition"] as const) {
      const series = Array.from(
        { length: floors - 1 },
        (_, i) => cutCounts(parts, i + 1, floors)[kind]!,
      );
      for (let i = 1; i < series.length; i++)
        expect(series[i], kind).toBeGreaterThan(series[i - 1]!);
    }
  });

  it("rejects k outside 1..floors", () => {
    const parts = partsAt(6);
    for (const k of [0, 7, 1.5]) expect(() => cutCounts(parts, k, 6)).toThrow(RangeError);
  });
});
