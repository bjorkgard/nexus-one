import type { Box, Vec3 } from "./zones";

// Layout of the `?palette=1` board (task 2.2, mockup C-2). Rows run along u, the screen-horizontal
// ground axis (1, 0, -1)/sqrt2, and stack along v, the screen-down ground axis (1, 0, 1)/sqrt2.
// The board and `framingBounds({ palette })` both read this module.
export const SIZE = 4;
export const PITCH = 7;
export const ROW_PITCH = 20;
export const YAW = Math.PI / 4;
export const SURFACE_SLOTS = 9;
export const PAINT_SLOTS = 8;
export const TOGETHER_HALF_U = 6;
export const TOGETHER_HALF_V = 4;
export const TOGETHER_WALL = 4.3;

const LABEL_HALF_WIDTH = 5;
const LABEL_DROP = (SIZE / 2) * Math.SQRT2 + 1.6;
const ROW_LABEL_RISE = 10;
const TITLE_RISE = 17;
const CUBE_HALF = (SIZE / 2) * Math.SQRT2;

export type SlotRow = "surfaces" | "paints";
export type Row = SlotRow | "together";

const ROW_V: Record<Row, number> = { surfaces: -ROW_PITCH, paints: 0, together: ROW_PITCH };
const COUNT: Record<SlotRow, number> = { surfaces: SURFACE_SLOTS, paints: PAINT_SLOTS };

export const place = (u: number, v: number, y = 0): Vec3 => [
  (u + v) * Math.SQRT1_2,
  y,
  (v - u) * Math.SQRT1_2,
];

export const slotU = (row: SlotRow, i: number) => (i - (COUNT[row] - 1) / 2) * PITCH;
export const rowV = (row: Row) => ROW_V[row];
export const swatchCentre = (row: SlotRow, i: number): Vec3 => place(slotU(row, i), ROW_V[row]);
export const swatchLabel = (row: SlotRow, i: number): Vec3 =>
  place(slotU(row, i), ROW_V[row] + LABEL_DROP);
export const rowLabel = (row: Row): Vec3 =>
  place(slotU("surfaces", 0), ROW_V[row] - ROW_LABEL_RISE);
export const title = (): Vec3 => place(0, ROW_V.surfaces - TITLE_RISE);

// Every point the framing must keep on screen: swatch footprints at ground and top, the Together
// tile and wall, and the label anchors padded by half a label width along u.
export const PALETTE_POINTS: Vec3[] = (() => {
  const points: Vec3[] = [];
  const rect = (u: number, v: number, halfU: number, halfV: number, top: number) => {
    for (const du of [-halfU, halfU])
      for (const dv of [-halfV, halfV])
        for (const y of [0, top]) points.push(place(u + du, v + dv, y));
  };
  for (const row of ["surfaces", "paints"] as const) {
    for (let i = 0; i < COUNT[row]; i++) {
      rect(slotU(row, i), ROW_V[row], CUBE_HALF, CUBE_HALF, SIZE);
      const [x, , z] = swatchLabel(row, i);
      rect((x - z) * Math.SQRT1_2, (x + z) * Math.SQRT1_2, LABEL_HALF_WIDTH, 0, 0);
    }
  }
  rect(0, ROW_V.together, TOGETHER_HALF_U, TOGETHER_HALF_V, TOGETHER_WALL);
  for (const anchor of [rowLabel("surfaces"), rowLabel("paints"), rowLabel("together"), title()]) {
    const [x, , z] = anchor;
    rect((x - z) * Math.SQRT1_2, (x + z) * Math.SQRT1_2, LABEL_HALF_WIDTH, 0, 0);
  }
  return points;
})();

// The framing box is axis-aligned in world space, but the board is rotated 45 degrees, so a plain
// AABB would waste a third of the screen. `fitZoom` only reads the projected corners, so this is the
// box whose corners project to the board's own screen extents: x and z half-extents equal, centred
// on the board.
function derive(): Box {
  // Screen x is u; screen y is -v / sqrt3 + 2y / sqrt6.
  const pts = PALETTE_POINTS.map(([x, y, z]) => ({
    u: (x - z) * Math.SQRT1_2,
    v: (x + z) * Math.SQRT1_2,
    y,
  }));
  const range = (f: (p: (typeof pts)[number]) => number) => {
    const values = pts.map(f);
    return [Math.min(...values), Math.max(...values)] as const;
  };
  const [uMin, uMax] = range((p) => p.u);
  const [sMin, sMax] = range((p) => -p.v / Math.sqrt(3) + (2 * p.y) / Math.sqrt(6));
  const [yMin, yMax] = range((p) => p.y);
  const halfX = (uMax - uMin) / 2;
  const halfY = (sMax - sMin) / 2;
  const centreU = (uMin + uMax) / 2;
  const centreY = (yMin + yMax) / 2;
  // Centre v so the projected vertical centre matches: s = -v/sqrt3 + 2y/sqrt6.
  const centreV = -Math.sqrt(3) * ((sMin + sMax) / 2 - (2 * centreY) / Math.sqrt(6));
  // Box corners project to halfX = (hx + hz) / sqrt2 and halfY = (hx + hz + 2 hy) / sqrt6.
  const h = halfX / Math.SQRT2;
  const hy = Math.max((yMax - yMin) / 2, (halfY * Math.sqrt(6) - 2 * h) / 2);
  const [cx, , cz] = place(centreU, centreV);
  return { min: [cx - h, centreY - hy, cz - h], max: [cx + h, centreY + hy, cz + h] };
}

export const PALETTE_BOUNDS: Box = derive();
