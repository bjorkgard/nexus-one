import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { TOKENS } from "../shared/tokens";
import type { GeometryParams } from "./geometry-cache";
import type { PaletteName } from "./palette";
import { LOOK } from "./stage-look";
import { GLASS_HALF, ZoneError } from "./dimensions";
import type { Layout, Rect } from "./layout";
import { FLOOR_HEIGHT, FOOTPRINTS, assertFloors, type Vec3 } from "./zones";

// Tower shell parts (this file) and interior parts (interior.ts) share one union, so the component maps both generically.
export const TOWER_PART_KINDS = [
  "slab",
  "slabHoled",
  "column",
  "glass",
  "glow",
  "glowHoled",
  "roofDeck",
  "parapet",
  "parapetEdge",
  "ac",
  "partition",
  "coreFrame",
  "floorTint",
  "furniture",
  "penthouseGlass",
  "penthouseRoof",
  "penthouseGlow",
] as const;
export type TowerPartKind = (typeof TOWER_PART_KINDS)[number];

// One InstancedMesh per part: the component maps these generically. Instances are ordered by floor, ascending.
export interface TowerPart {
  readonly kind: TowerPartKind;
  readonly material: PaletteName;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  // Pass both to `getGeometry`; `buildGeometry` is its build callback.
  readonly geometryKey: { readonly kind: string; readonly params: GeometryParams };
  readonly buildGeometry: () => BufferGeometry;
  readonly matrices: readonly Matrix4[];
  // Optional per-instance colours, one per matrix, for white-based materials (`furniture`).
  readonly colors?: readonly Color[];
}

export interface AcUnit {
  readonly id: string;
  readonly name: string;
  // Box centre in world metres.
  readonly position: Vec3;
}

export interface Tower {
  readonly parts: readonly TowerPart[];
  readonly acUnits: readonly AcUnit[];
}

const T = LOOK.tower;
const I = LOOK.interior;
// The tower footprint is square and centred on the origin: the slab covers it, the glass hull sits `glassInset` inside.
const SLAB_HALF = FOOTPRINTS.tower.x[1]!;
const GLOW_OUTER_HALF = GLASS_HALF - T.glowInset;
const GLOW_INNER_HALF = GLOW_OUTER_HALF - T.glowWidth;

// Y of the top of floor `floor`'s slab; floor `floors` is the roof deck.
export function floorTopY(floor: number): number {
  return floor * FLOOR_HEIGHT + T.slabTopLift;
}

const IDENTITY = new Quaternion();
const box = (position: Vec3, size: Vec3) =>
  new Matrix4().compose(new Vector3(...position), IDENTITY, new Vector3(...size));

// Pushes one face as two triangles, wound so the face normal points along `normal`.
function pushFace(
  out: { position: number[]; normal: number[]; color: number[] },
  corners: Vec3[],
  normal: Vec3,
  color: Color,
) {
  const [a, b, c, d] = corners.map((p) => new Vector3(...p)) as [
    Vector3,
    Vector3,
    Vector3,
    Vector3,
  ];
  const facing = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
  const order = facing.dot(new Vector3(...normal)) > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  for (const p of order) {
    out.position.push(p.x, p.y, p.z);
    out.normal.push(...normal);
    out.color.push(color.r, color.g, color.b);
  }
}

// Rectangles [x0, z0, x1, z1] that tile the square of half-size `half` less `hole`, or the whole square without one.
function squareAround(half: number, hole?: Rect): [number, number, number, number][] {
  if (!hole) return [[-half, -half, half, half]];
  const [x0, z0] = hole.min;
  const [x1, z1] = hole.max;
  return (
    [
      [-half, -half, x0, half],
      [x1, -half, half, half],
      [x0, -half, x1, z0],
      [x0, z1, x1, half],
    ] as [number, number, number, number][]
  ).filter(([a, b, c, d]) => c - a > 1e-9 && d - b > 1e-9);
}

// Slab top at y = 0, `thickness` below it. The top is split at the glass line: a ring (SLAB_HALF to GLASS_HALF) in
// `outerTop`, the inside in `innerTop`. Non-indexed, so the seam vertices are duplicated and no triangle blends colours.
// With a `hole` (inside the glass line) the top and bottom skip it and its four rim faces run down the thickness.
function buildSlabGeometry(
  outerTop: string,
  innerTop: string,
  side: string,
  hole?: Rect,
): BufferGeometry {
  const out = { position: [] as number[], normal: [] as number[], color: [] as number[] };
  const outer = new Color(outerTop);
  const inner = new Color(innerTop);
  const sides = new Color(side);
  const up: Vec3 = [0, 1, 0];
  const ring = (h: number): Vec3[] => [
    [-h, 0, -h],
    [-h, 0, h],
    [h, 0, h],
    [h, 0, -h],
  ];
  const flat = ([x0, z0, x1, z1]: [number, number, number, number], y: number): Vec3[] => [
    [x0, y, z0],
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
  ];
  const o = ring(SLAB_HALF);
  const i = ring(GLASS_HALF);
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    pushFace(out, [o[k]!, o[n]!, i[n]!, i[k]!], up, outer);
  }
  for (const r of squareAround(GLASS_HALF, hole)) pushFace(out, flat(r, 0), up, inner);
  const t = -T.slabThickness;
  for (const r of squareAround(SLAB_HALF, hole)) pushFace(out, flat(r, t), [0, -1, 0], sides);
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    const [ax, , az] = o[k]!;
    const [bx, , bz] = o[n]!;
    const normal: Vec3 = [Math.sign(ax + bx), 0, Math.sign(az + bz)];
    pushFace(out, [o[k]!, o[n]!, [bx, t, bz], [ax, t, az]], normal, sides);
  }
  if (hole) {
    const [x0, z0] = hole.min;
    const [x1, z1] = hole.max;
    // Each rim face looks into the hole.
    pushFace(
      out,
      [
        [x0, 0, z0],
        [x1, 0, z0],
        [x1, t, z0],
        [x0, t, z0],
      ],
      [0, 0, 1],
      sides,
    );
    pushFace(
      out,
      [
        [x0, 0, z1],
        [x1, 0, z1],
        [x1, t, z1],
        [x0, t, z1],
      ],
      [0, 0, -1],
      sides,
    );
    pushFace(
      out,
      [
        [x0, 0, z0],
        [x0, 0, z1],
        [x0, t, z1],
        [x0, t, z0],
      ],
      [1, 0, 0],
      sides,
    );
    pushFace(
      out,
      [
        [x1, 0, z0],
        [x1, 0, z1],
        [x1, t, z1],
        [x1, t, z0],
      ],
      [-1, 0, 0],
      sides,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(out.position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(out.normal, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(out.color, 3));
  return geometry;
}

// Convex polygon (x, z pairs) clipped to a box: Sutherland-Hodgman against its four sides.
function clipToBox(poly: [number, number][], [x0, z0, x1, z1]: number[]): [number, number][] {
  const sides: ((p: [number, number]) => number)[] = [
    (p) => p[0] - x0,
    (p) => x1 - p[0],
    (p) => p[1] - z0,
    (p) => z1 - p[1],
  ];
  let out = poly;
  for (const d of sides) {
    const next: [number, number][] = [];
    out.forEach((a, i) => {
      const b = out[(i + 1) % out.length]!;
      const [da, db] = [d(a), d(b)];
      if (da >= 0) next.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    });
    out = next;
  }
  return out;
}

// Flat square ring at y = 0 facing up, from GLOW_OUTER_HALF in to GLOW_INNER_HALF. With a `hole` the ring is
// cut where it crosses the hole, so nothing glows over the void.
function buildGlowGeometry(hole?: Rect): BufferGeometry {
  const out = { position: [] as number[], normal: [] as number[], color: [] as number[] };
  const ring = (h: number): Vec3[] => [
    [-h, 0, -h],
    [-h, 0, h],
    [h, 0, h],
    [h, 0, -h],
  ];
  const o = ring(GLOW_OUTER_HALF);
  const i = ring(GLOW_INNER_HALF);
  const white = new Color("#ffffff");
  // The ring less the hole, as four disjoint boxes around it: left, right, and below and above it between them.
  const big = SLAB_HALF;
  const keep = hole
    ? [
        [-big, -big, hole.min[0], big],
        [hole.max[0], -big, big, big],
        [hole.min[0], -big, hole.max[0], hole.min[1]],
        [hole.min[0], hole.max[1], hole.max[0], big],
      ]
    : [[-big, -big, big, big]];
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    const quad: Vec3[] = [o[k]!, o[n]!, i[n]!, i[k]!];
    for (const box of keep) {
      const piece = clipToBox(
        quad.map((p): [number, number] => [p[0], p[2]]),
        box,
      );
      // Fan from the first corner; a clipped quad has 3 to 6 corners.
      for (let c = 1; c + 1 < piece.length; c++) {
        for (const [x, z] of [piece[0]!, piece[c]!, piece[c + 1]!]) {
          out.position.push(x, 0, z);
          out.normal.push(0, 1, 0);
          out.color.push(white.r, white.g, white.b);
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(out.position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(out.normal, 3));
  return geometry;
}

// Every geometry-cache kind the tower builds; Stage clears these on HMR dispose.
export const TOWER_GEOMETRY_KINDS = [
  "tower-slab",
  "tower-slab-hole",
  "tower-roof",
  "tower-box",
  "tower-frame-box",
  "tower-glass",
  "tower-glow",
  "tower-glow-hole",
] as const;

const unitBox = { kind: "tower-box", params: {} } as const;
const buildUnitBox = () => new BoxGeometry(1, 1, 1);

// Unit box with one baked vertex colour, for the `ground` material: dark frame parts without a new material.
const frameBoxKey = { kind: "tower-frame-box", params: { color: TOKENS.slab.frame } } as const;
function buildFrameBox(): BufferGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  const c = new Color(TOKENS.slab.frame);
  const colors = Array.from({ length: geometry.getAttribute("position").count }, () => [
    c.r,
    c.g,
    c.b,
  ]).flat();
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function slabKey(kind: string, outerTop: string, innerTop: string) {
  return {
    kind,
    params: {
      outerTop,
      innerTop,
      side: TOKENS.slab.frame,
      inset: T.glassInset,
      thickness: T.slabThickness,
    },
  };
}

// Instances of the unit plane (normal +z): x axis along the face, exact axis-aligned entries so shared edges match to the bit.
// `u0`..`u1` is the piece's extent along that axis (the whole face by default).
function glassMatrix(
  face: 0 | 1 | 2 | 3,
  y0: number,
  y1: number,
  u0 = -GLASS_HALF,
  u1 = GLASS_HALF,
): Matrix4 {
  const width = u1 - u0;
  const height = y1 - y0;
  const axes: [Vec3, Vec3][] = [
    [
      [1, 0, 0],
      [0, 0, 1],
    ], // +z face
    [
      [0, 0, -1],
      [1, 0, 0],
    ], // +x face
    [
      [-1, 0, 0],
      [0, 0, -1],
    ], // -z face
    [
      [0, 0, 1],
      [-1, 0, 0],
    ], // -x face
  ];
  const [x, n] = axes[face]!;
  const m = new Matrix4().makeBasis(
    new Vector3(...x).multiplyScalar(width),
    new Vector3(0, height, 0),
    new Vector3(...n),
  );
  const mid = (u0 + u1) / 2;
  return m.setPosition(
    n[0] * GLASS_HALF + x[0] * mid,
    (y0 + y1) / 2,
    n[2] * GLASS_HALF + x[2] * mid,
  );
}

// [lo, hi] less the gaps, as the pieces left.
function cutSpans(lo: number, hi: number, gaps: [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[lo, hi]];
  for (const [g0, g1] of gaps) {
    pieces = pieces.flatMap(([a, b]): [number, number][] => {
      if (g1 <= a || g0 >= b) return [[a, b]];
      return [
        ...(g0 > a ? [[a, g0] as [number, number]] : []),
        ...(g1 < b ? [[g1, b] as [number, number]] : []),
      ];
    });
  }
  return pieces;
}

function columnOffsets(): number[] {
  const n = Math.floor((2 * GLASS_HALF) / T.mullionSpacing);
  return Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * T.mullionSpacing);
}

// Glass face index (see `glassMatrix`) of an entrance, and the sign that turns z into the face's own axis.
const ENTRANCE_FACE = { "+x": [1, -1], "-x": [3, 1] } as const;

// `floors` counts the lobby (floor 0); floors 0..floors-1 get a slab and a glass wall, the roof deck sits at floor `floors`.
// `openings` come from the layout (the registry owns it): the entrance gaps cut the floor-0 glass, the slab hole the floor-1 slab.
export function buildTower({
  floors,
  openings,
}: {
  floors: number;
  openings: Layout["openings"];
}): Tower {
  assertFloors(floors);
  const hole = openings.slabHole;
  const [h0, h1] = [hole.min, hole.max];
  const slackLine = GLASS_HALF + 1e-6;
  if (
    !Number.isInteger(hole.floor) ||
    hole.floor < 1 ||
    hole.floor >= floors ||
    h1[0] - h0[0] <= 0 ||
    h1[1] - h0[1] <= 0 ||
    Math.max(Math.abs(h0[0]), Math.abs(h0[1]), Math.abs(h1[0]), Math.abs(h1[1])) > slackLine
  ) {
    throw new ZoneError(
      `slab hole must be a non-empty rectangle inside the glass line on floor 1..${floors - 1}, got floor ${hole.floor} ` +
        `(${h0.join(", ")}) to (${h1.join(", ")})`,
    );
  }
  const slabs: Matrix4[] = [];
  const columns: Matrix4[] = [];
  const glass: Matrix4[] = [];
  const glow: Matrix4[] = [];
  const glowHoled: Matrix4[] = [];
  const mullions = columnOffsets();
  // An entrance with its jambs must sit inside one mullion bay, clear of every column.
  const bays = [-GLASS_HALF, ...mullions, GLASS_HALF];
  const jamb = I.portalDepth;
  for (const e of openings.entrances) {
    const [lo, hi] = [e.centre - e.width / 2 - jamb, e.centre + e.width / 2 + jamb];
    const inBay = bays.some(
      (m, i) =>
        i + 1 < bays.length && lo >= m + T.columnSize / 2 && hi <= bays[i + 1]! - T.columnSize / 2,
    );
    if (!inBay) {
      throw new ZoneError(
        `entrance on ${e.face} (floor ${e.floor}) spans ${lo} to ${hi} m with its jambs, which overlaps a column or leaves its mullion bay`,
      );
    }
  }
  const posts: [number, number][] = [
    [-GLASS_HALF, -GLASS_HALF],
    [-GLASS_HALF, GLASS_HALF],
    [GLASS_HALF, GLASS_HALF],
    [GLASS_HALF, -GLASS_HALF],
    ...mullions.flatMap((m): [number, number][] => [
      [m, GLASS_HALF],
      [m, -GLASS_HALF],
      [GLASS_HALF, m],
      [-GLASS_HALF, m],
    ]),
  ];
  for (let k = 0; k < floors; k++) {
    const top = floorTopY(k);
    if (k !== hole.floor) slabs.push(new Matrix4().makeTranslation(0, top, 0));
    (k === hole.floor ? glowHoled : glow).push(
      new Matrix4().makeTranslation(0, top + T.glowLift, 0),
    );
    for (const face of [0, 1, 2, 3] as const) {
      // Entrance gaps run the full floor height: the pieces beside them replace the whole-face plane.
      const gaps = openings.entrances
        .filter((e) => e.floor === k && ENTRANCE_FACE[e.face]?.[0] === face)
        .map((e): [number, number] => {
          const sign = ENTRANCE_FACE[e.face][1];
          const [a, b] = [e.centre - e.width / 2, e.centre + e.width / 2];
          return sign < 0 ? [-b, -a] : [a, b];
        })
        .sort((p, q) => p[0] - q[0]);
      for (const [u0, u1] of cutSpans(-GLASS_HALF, GLASS_HALF, gaps)) {
        glass.push(glassMatrix(face, top, floorTopY(k + 1), u0, u1));
      }
    }
    // Columns run from inside one slab to inside the next, so no cap lies in a slab top plane.
    const y = top - T.slabThickness / 2 + FLOOR_HEIGHT / 2;
    for (const [x, z] of posts) {
      columns.push(box([x, y, z], [T.columnSize, FLOOR_HEIGHT, T.columnSize]));
    }
    // Jambs beside each gap, as tall as the columns and centred on the glass plane like them.
    for (const e of openings.entrances.filter((o) => o.floor === k)) {
      const x = (e.face === "+x" ? 1 : -1) * GLASS_HALF;
      for (const z of [e.centre - e.width / 2 - jamb / 2, e.centre + e.width / 2 + jamb / 2]) {
        columns.push(box([x, y, z], [jamb, FLOOR_HEIGHT, jamb]));
      }
    }
  }

  const roofY = floorTopY(floors);
  const edge = SLAB_HALF - T.parapetThickness / 2;
  const longSide = 2 * SLAB_HALF;
  const shortSide = longSide - 2 * T.parapetThickness;
  const py = roofY + T.parapetHeight / 2;
  const parapet = [
    box([0, py, edge], [longSide, T.parapetHeight, T.parapetThickness]),
    box([0, py, -edge], [longSide, T.parapetHeight, T.parapetThickness]),
    box([edge, py, 0], [T.parapetThickness, T.parapetHeight, shortSide]),
    box([-edge, py, 0], [T.parapetThickness, T.parapetHeight, shortSide]),
  ];
  // Cyan bars centred on the parapet top; the z bars stop short of the x bars so no top faces overlap.
  const ey = roofY + T.parapetHeight + T.parapetEdgeHeight / 2;
  const barLong = 2 * edge + T.parapetEdgeWidth;
  const barShort = 2 * edge - T.parapetEdgeWidth;
  const parapetEdge = [
    box([0, ey, edge], [barLong, T.parapetEdgeHeight, T.parapetEdgeWidth]),
    box([0, ey, -edge], [barLong, T.parapetEdgeHeight, T.parapetEdgeWidth]),
    box([edge, ey, 0], [T.parapetEdgeWidth, T.parapetEdgeHeight, barShort]),
    box([-edge, ey, 0], [T.parapetEdgeWidth, T.parapetEdgeHeight, barShort]),
  ];

  // One 3 × 1.4 × 2 m unit and a pair of 1.4 × 1 × 1.4 m units ([x, y, z]) sitting on the roof deck.
  const acSpec: { x: number; z: number; size: Vec3 }[] = [
    { x: -5, z: 4, size: [3, 1.4, 2] },
    { x: 7, z: -4, size: [1.4, 1, 1.4] },
    { x: 9.2, z: -4, size: [1.4, 1, 1.4] },
  ];
  const acUnits: AcUnit[] = acSpec.map(({ x, z, size }, i) => ({
    id: `ac-${i + 1}`,
    name: `AC unit ${i + 1}`,
    position: [x, roofY + size[1] / 2, z],
  }));
  const ac = acSpec.map(({ size }, i) => box(acUnits[i]!.position, size));

  const part = (
    kind: TowerPartKind,
    material: PaletteName,
    flags: { cast: boolean; receive: boolean },
    geometryKey: TowerPart["geometryKey"],
    buildGeometry: () => BufferGeometry,
    matrices: Matrix4[],
  ): TowerPart => ({
    kind,
    material,
    castShadow: flags.cast,
    receiveShadow: flags.receive,
    geometryKey,
    buildGeometry,
    matrices,
  });
  const interior = TOKENS.slab.interiorTop;
  const frame = TOKENS.slab.frame;
  const caster = { cast: true, receive: false };
  const none = { cast: false, receive: false };
  const parts: TowerPart[] = [
    part(
      "slab",
      "ground",
      caster,
      slabKey("tower-slab", frame, interior),
      () => buildSlabGeometry(frame, interior, frame),
      slabs,
    ),
    part(
      "slabHoled",
      "ground",
      caster,
      {
        ...slabKey("tower-slab-hole", frame, interior),
        params: {
          ...slabKey("tower-slab-hole", frame, interior).params,
          holeMinX: h0[0],
          holeMinZ: h0[1],
          holeMaxX: h1[0],
          holeMaxZ: h1[1],
        },
      },
      () => buildSlabGeometry(frame, interior, frame, hole),
      [new Matrix4().makeTranslation(0, floorTopY(hole.floor), 0)],
    ),
    part("column", "ground", caster, frameBoxKey, buildFrameBox, columns),
    part(
      "glass",
      "glass",
      none,
      { kind: "tower-glass", params: {} },
      () => new PlaneGeometry(1, 1),
      glass,
    ),
    part(
      "glow",
      "trimWhite",
      none,
      {
        kind: "tower-glow",
        params: { outer: GLOW_OUTER_HALF, inner: GLOW_INNER_HALF },
      },
      () => buildGlowGeometry(),
      glow,
    ),
    part(
      "glowHoled",
      "trimWhite",
      none,
      {
        kind: "tower-glow-hole",
        params: {
          outer: GLOW_OUTER_HALF,
          inner: GLOW_INNER_HALF,
          holeMinX: h0[0],
          holeMinZ: h0[1],
          holeMaxX: h1[0],
          holeMaxZ: h1[1],
        },
      },
      () => buildGlowGeometry(hole),
      glowHoled,
    ),
    part(
      "roofDeck",
      "ground",
      caster,
      slabKey("tower-roof", frame, frame),
      () => buildSlabGeometry(frame, frame, frame),
      [new Matrix4().makeTranslation(0, roofY, 0)],
    ),
    part("parapet", "ground", caster, frameBoxKey, buildFrameBox, parapet),
    part("parapetEdge", "trimCyan", none, unitBox, buildUnitBox, parapetEdge),
    part("ac", "ground", caster, frameBoxKey, buildFrameBox, ac),
  ];
  return { parts, acUnits };
}
