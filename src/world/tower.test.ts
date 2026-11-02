import { Color, FrontSide, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { hexToLinear } from "../shared/color-metrics";
import { TOKENS } from "../shared/tokens";
import { fitZoom, framingBounds } from "./camera";
import { palette } from "./palette";
import { LOOK } from "./stage-look";
import {
  GLASS_HALF,
  TOWER_GEOMETRY_KINDS,
  buildTower,
  floorTopY,
  type TowerPart,
  type TowerPartKind,
} from "./tower";
import { FLOOR_HEIGHT, MAX_FLOORS, MIN_FLOORS, assertFloors, createZoneRegistry } from "./zones";

const T = LOOK.tower;
const EPS = 1e-9;

function part(floors: number, kind: TowerPartKind): TowerPart {
  const found = buildTower({ floors }).parts.find((p) => p.kind === kind);
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
      expect(() => buildTower({ floors: bad })).toThrow(/floors must be an integer in \[2, 40\]/);
      expect(() => createZoneRegistry({ floors: bad })).toThrow(
        /floors must be an integer in \[2, 40\]/,
      );
    }
    expect(() => buildTower({ floors: 1 })).toThrow("floors must be an integer in [2, 40], got 1");
    expect(() => buildTower({ floors: 41 })).toThrow("got 41");
  });
});

describe("buildTower counts", () => {
  it.each([2, 6, 40])("floors = %i: one slab, glass set, glow and column set per floor", (n) => {
    const { parts } = buildTower({ floors: n });
    const count = (kind: TowerPartKind) => parts.filter((p) => p.kind === kind)[0]!.matrices.length;
    expect(parts.map((p) => p.kind).sort()).toEqual(
      ["ac", "column", "glass", "glow", "parapet", "parapetEdge", "roofDeck", "slab"].sort(),
    );
    expect(count("slab")).toBe(n);
    expect(count("glass")).toBe(["+x", "-x", "+z", "-z"].length * n);
    expect(count("glow")).toBe(n);
    expect(count("column")).toBe(20 * n);
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
    for (const p of buildTower({ floors: 6 }).parts) {
      for (const m of p.matrices) expect(m.determinant(), p.kind).toBeGreaterThan(0);
    }
  });

  it("shares edges exactly between adjacent planes, with no overlap", () => {
    const floors = 6;
    const edges = new Map<string, number>();
    const key = (a: Vector3, b: Vector3) => {
      const f = (v: Vector3) => [v.x, v.y, v.z].map((n) => n.toFixed(6)).join(",");
      return [f(a), f(b)].sort().join("|");
    };
    for (const m of part(floors, "glass").matrices) {
      const c = [
        new Vector3(-0.5, -0.5, 0),
        new Vector3(0.5, -0.5, 0),
        new Vector3(0.5, 0.5, 0),
        new Vector3(-0.5, 0.5, 0),
      ].map((v) => v.applyMatrix4(m));
      for (let i = 0; i < 4; i++) {
        const k = key(c[i]!, c[(i + 1) % 4]!);
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    // Per floor: 4 vertical corner edges shared by 2 planes; per floor boundary: 4 floor-line edges shared by 2 planes.
    const counts = [...edges.values()];
    expect(counts.filter((n) => n === 2)).toHaveLength(4 * floors + 4 * (floors - 1));
    expect(counts.filter((n) => n === 1)).toHaveLength(8); // bottom of floor 0 and top of the roof floor
    expect(counts.every((n) => n <= 2)).toBe(true);
    // Per hull face, floors tile the height without gap or overlap.
    for (const face of hullNormals) {
      const spans = part(floors, "glass")
        .matrices.filter((m) => new Vector3(0, 0, 1).transformDirection(m).distanceTo(face) < EPS)
        .map((m) => [m.elements[13]! - m.elements[5]! / 2, m.elements[13]! + m.elements[5]! / 2]);
      expect(spans).toHaveLength(floors);
      for (let i = 1; i < spans.length; i++) {
        expect(Math.abs(spans[i]![0]! - spans[i - 1]![1]!)).toBeLessThan(EPS);
      }
      expect(spans[0]![0]).toBeCloseTo(floorTopY(0), 9);
      expect(spans[floors - 1]![1]).toBeCloseTo(floorTopY(floors), 9);
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
    glow.matrices.forEach((m, k) => {
      expect(m.elements[13]! - floorTopY(k)).toBeGreaterThanOrEqual(T.minGap);
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

describe("parts: materials and shadows", () => {
  const table: Record<TowerPartKind, [string, boolean, boolean]> = {
    slab: ["ground", true, false],
    column: ["ground", true, false],
    glass: ["glass", false, false],
    glow: ["trimWhite", false, false],
    roofDeck: ["ground", true, false],
    parapet: ["ground", true, false],
    parapetEdge: ["trimCyan", false, false],
    ac: ["ground", true, false],
  };

  it("assigns material, cast and receive per part kind", () => {
    for (const p of buildTower({ floors: 6 }).parts) {
      expect([p.material, p.castShadow, p.receiveShadow], p.kind).toEqual(table[p.kind]);
    }
  });

  it("uses four palette materials in the tower", () => {
    const names = new Set(buildTower({ floors: 6 }).parts.map((p) => p.material));
    expect([...names].sort()).toEqual(["glass", "ground", "trimCyan", "trimWhite"].sort());
  });

  it("bakes the frame colour into the column, parapet and AC boxes", () => {
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
    const a = buildTower({ floors: 6 }).acUnits;
    const b = buildTower({ floors: 6 }).acUnits;
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((u) => u.id)).size).toBe(a.length);
    for (const u of a) {
      expect(u.name.length).toBeGreaterThan(0);
      expect(u.position[1]).toBeGreaterThan(floorTopY(6));
      expect(u.position[1]).toBeLessThan(floorTopY(6) + 2);
    }
    expect(buildTower({ floors: 40 }).acUnits.map((u) => u.id)).toEqual(a.map((u) => u.id));
  });

  it("matches the matrices of the ac part", () => {
    const { parts, acUnits } = buildTower({ floors: 6 });
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
    for (const p of buildTower({ floors }).parts) expect(kinds).toContain(p.geometryKey.kind);
  });
});
