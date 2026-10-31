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
import { FLOOR_HEIGHT, FOOTPRINTS, assertFloors, type Vec3 } from "./zones";

export type TowerPartKind =
  | "slab"
  | "column"
  | "glass"
  | "glow"
  | "roofDeck"
  | "parapet"
  | "parapetEdge"
  | "ac";

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
// The tower footprint is square and centred on the origin: the slab covers it, the glass hull sits `glassInset` inside.
const SLAB_HALF = FOOTPRINTS.tower.x[1]!;
export const GLASS_HALF = SLAB_HALF - T.glassInset;
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

// Slab top at y = 0, `thickness` below it. The top is split at the glass line: a ring (SLAB_HALF to GLASS_HALF) in
// `outerTop`, the inside in `innerTop`. Non-indexed, so the seam vertices are duplicated and no triangle blends colours.
function buildSlabGeometry(outerTop: string, innerTop: string, side: string): BufferGeometry {
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
  const o = ring(SLAB_HALF);
  const i = ring(GLASS_HALF);
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    pushFace(out, [o[k]!, o[n]!, i[n]!, i[k]!], up, outer);
  }
  pushFace(out, i, up, inner);
  const t = -T.slabThickness;
  const bottom = ring(SLAB_HALF).map(([x, , z]): Vec3 => [x, t, z]);
  pushFace(out, bottom, [0, -1, 0], sides);
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    const [ax, , az] = o[k]!;
    const [bx, , bz] = o[n]!;
    const normal: Vec3 = [Math.sign(ax + bx), 0, Math.sign(az + bz)];
    pushFace(out, [o[k]!, o[n]!, [bx, t, bz], [ax, t, az]], normal, sides);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(out.position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(out.normal, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(out.color, 3));
  return geometry;
}

// Flat square ring at y = 0 facing up, from GLOW_OUTER_HALF in to GLOW_INNER_HALF.
function buildGlowGeometry(): BufferGeometry {
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
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    pushFace(out, [o[k]!, o[n]!, i[n]!, i[k]!], [0, 1, 0], white);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(out.position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(out.normal, 3));
  return geometry;
}

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
function glassMatrix(face: 0 | 1 | 2 | 3, y0: number, y1: number): Matrix4 {
  const width = 2 * GLASS_HALF;
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
  return m.setPosition(n[0] * GLASS_HALF, (y0 + y1) / 2, n[2] * GLASS_HALF);
}

function columnOffsets(): number[] {
  const n = Math.floor((2 * GLASS_HALF) / T.mullionSpacing);
  return Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * T.mullionSpacing);
}

// `floors` counts the lobby (floor 0); floors 0..floors-1 get a slab and a glass wall, the roof deck sits at floor `floors`.
export function buildTower({ floors }: { floors: number }): Tower {
  assertFloors(floors);
  const slabs: Matrix4[] = [];
  const columns: Matrix4[] = [];
  const glass: Matrix4[] = [];
  const glow: Matrix4[] = [];
  const mullions = columnOffsets();
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
    slabs.push(new Matrix4().makeTranslation(0, top, 0));
    glow.push(new Matrix4().makeTranslation(0, top + T.glowLift, 0));
    for (const face of [0, 1, 2, 3] as const) glass.push(glassMatrix(face, top, floorTopY(k + 1)));
    // Columns run from inside one slab to inside the next, so no cap lies in a slab top plane.
    const y = top - T.slabThickness / 2 + FLOOR_HEIGHT / 2;
    for (const [x, z] of posts) {
      columns.push(box([x, y, z], [T.columnSize, FLOOR_HEIGHT, T.columnSize]));
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

  // One 3 x 2 x 1.4 m unit and a pair of 1.4 x 1.4 x 1 m units sitting on the roof deck; sizes are [x, y, z].
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
      buildGlowGeometry,
      glow,
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
