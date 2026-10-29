import { describe, expect, it } from "vite-plus/test";
import { fitZoom } from "./camera";
import type { Vec3 } from "./zones";
import {
  PAINT_SLOTS,
  PALETTE_BOUNDS,
  PALETTE_POINTS,
  PITCH,
  SIZE,
  SURFACE_SLOTS,
  place,
  rowLabel,
  slotU,
  swatchCentre,
  swatchLabel,
  title,
} from "./palette-layout";

// Screen coordinates on a 1 px per metre camera: x along RIGHT, y along UP.
const screen = ([x, y, z]: Vec3): [number, number] => [
  (x - z) * Math.SQRT1_2,
  (-x + 2 * y - z) / Math.sqrt(6),
];

describe("palette layout", () => {
  it("place maps u to screen-right and v to screen-down on the ground", () => {
    const [sx0, sy0] = screen(place(0, 0));
    const [sx1, sy1] = screen(place(5, 0));
    expect(sx1 - sx0).toBeCloseTo(5, 9);
    expect(sy1 - sy0).toBeCloseTo(0, 9);
    const [sx2, sy2] = screen(place(0, 5));
    expect(sx2 - sx0).toBeCloseTo(0, 9);
    expect(sy2 - sy0).toBeLessThan(0);
  });

  it("puts every row's swatches on one horizontal screen line, rows stacked downward", () => {
    for (const [row, n] of [
      ["surfaces", SURFACE_SLOTS],
      ["paints", PAINT_SLOTS],
    ] as const) {
      const ys = Array.from({ length: n }, (_, i) => screen(swatchCentre(row, i))[1]);
      for (const y of ys) expect(y).toBeCloseTo(ys[0]!, 9);
      const xs = Array.from({ length: n }, (_, i) => screen(swatchCentre(row, i))[0]);
      expect(xs[1]! - xs[0]!).toBeCloseTo(PITCH, 9);
    }
    const down = (row: "surfaces" | "paints") => screen(swatchCentre(row, 0))[1];
    expect(down("paints")).toBeLessThan(down("surfaces"));
  });

  it("keeps labels clear of the next row and the title above the first row", () => {
    expect(screen(title())[1]).toBeGreaterThan(screen(rowLabel("surfaces"))[1]);
    expect(screen(rowLabel("surfaces"))[1]).toBeGreaterThan(screen(swatchCentre("surfaces", 0))[1]);
    // A surface label sits under its swatch and clear above the paints row's cube tops.
    const labelY = screen(swatchLabel("surfaces", 0))[1];
    const paintTopY = screen(place(0, 0, SIZE))[1] + (SIZE * Math.SQRT2) / Math.sqrt(3);
    expect(labelY).toBeLessThan(screen(swatchCentre("surfaces", 0))[1]);
    expect(labelY).toBeGreaterThan(paintTopY);
  });

  it("slots are centred on u = 0", () => {
    expect(slotU("surfaces", 0)).toBeCloseTo(-slotU("surfaces", SURFACE_SLOTS - 1), 9);
    expect(slotU("paints", 0)).toBeCloseTo(-slotU("paints", PAINT_SLOTS - 1), 9);
  });

  it("derives a bounds box that contains every layout point once projected", () => {
    const zoom = fitZoom(PALETTE_BOUNDS, { width: 1440, height: 900 }, 0)!;
    const c = [
      (PALETTE_BOUNDS.min[0] + PALETTE_BOUNDS.max[0]) / 2,
      (PALETTE_BOUNDS.min[1] + PALETTE_BOUNDS.max[1]) / 2,
      (PALETTE_BOUNDS.min[2] + PALETTE_BOUNDS.max[2]) / 2,
    ] as const;
    const [cx, cy] = screen(c);
    for (const p of PALETTE_POINTS) {
      const [px, py] = screen(p);
      expect(Math.abs(px - cx) * zoom).toBeLessThanOrEqual(720 + 1e-6);
      expect(Math.abs(py - cy) * zoom).toBeLessThanOrEqual(450 + 1e-6);
    }
  });

  it("lays 9 + 8 swatch slots at a pitch that leaves room for labels at 1440 px", () => {
    const zoom = fitZoom(PALETTE_BOUNDS, { width: 1440, height: 900 })!;
    expect(PITCH * zoom).toBeGreaterThanOrEqual(115);
  });
});
