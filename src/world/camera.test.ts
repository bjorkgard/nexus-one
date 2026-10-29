import { describe, expect, it } from "vite-plus/test";
import {
  ISO_PITCH,
  ISO_YAW,
  cameraRig,
  cellOpacity,
  fitZoom,
  framingBounds,
  isoDirection,
} from "./camera";
import { createZoneRegistry, DEFAULT_FLOORS, type Vec3 } from "./zones";

const bounds = framingBounds({ zonesOverlay: false });

const RIGHT: Vec3 = [Math.SQRT1_2, 0, -Math.SQRT1_2];
const UP: Vec3 = [-1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6)];

function corners(b: { min: Vec3; max: Vec3 }): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("iso constants", () => {
  it("ISO_PITCH is 35.264 degrees", () => {
    expect(ISO_PITCH * (180 / Math.PI)).toBeCloseTo(35.264, 3);
  });

  it("isoDirection is a unit vector with yaw 45 and pitch 35.264 degrees", () => {
    const d = isoDirection();
    expect(Math.hypot(...d)).toBeCloseTo(1, 12);
    expect(Math.atan2(-d[0], -d[2])).toBeCloseTo(ISO_YAW, 12);
    expect(Math.asin(-d[1])).toBeCloseTo(ISO_PITCH, 12);
  });
});

describe("framingBounds", () => {
  it("is the 120 m slab without the overlay and the campus box with it", () => {
    expect(bounds.min).toEqual([-60, -1.4, -60]);
    expect(bounds.max).toEqual([60, 0, 60]);
    const campus = createZoneRegistry({ floors: DEFAULT_FLOORS }).byId("campus")!.box;
    expect(framingBounds({ zonesOverlay: true })).toEqual(campus);
  });
});

describe("cameraRig", () => {
  it("puts the whole box between near and far", () => {
    const rig = cameraRig(bounds);
    const diagonal = Math.hypot(120, 1.4, 120);
    expect(rig.distance).toBeCloseTo(diagonal, 9);
    expect(rig.near).toBe(0.1);
    expect(rig.far).toBeCloseTo(2 * diagonal, 9);
  });
});

describe("fitZoom", () => {
  const centre: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];

  it.each([
    { width: 1600, height: 900 },
    { width: 600, height: 1000 },
    { width: 800, height: 800 },
  ])("keeps all 8 corners inside $width x $height with the margin", (viewport) => {
    const zoom = fitZoom(bounds, viewport, 0.15)!;
    let maxX = 0;
    let maxY = 0;
    for (const c of corners(bounds)) {
      const rel: Vec3 = [c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]];
      maxX = Math.max(maxX, Math.abs(dot(rel, RIGHT)) * zoom);
      maxY = Math.max(maxY, Math.abs(dot(rel, UP)) * zoom);
    }
    expect(maxX).toBeLessThanOrEqual(viewport.width / 2);
    expect(maxY).toBeLessThanOrEqual(viewport.height / 2);
    const fill = Math.max((2 * maxX) / viewport.width, (2 * maxY) / viewport.height);
    expect(fill).toBeCloseTo(0.85, 6);
  });

  it("returns null for a zero-size viewport", () => {
    expect(fitZoom(bounds, { width: 0, height: 600 })).toBeNull();
    expect(fitZoom(bounds, { width: 800, height: 0 })).toBeNull();
  });
});

describe("cellOpacity", () => {
  it("is 1 at 10 px and above, 0 at 6 px and below, linear between", () => {
    expect(cellOpacity(12)).toBe(1);
    expect(cellOpacity(10)).toBe(1);
    expect(cellOpacity(8)).toBeCloseTo(0.5, 12);
    expect(cellOpacity(6)).toBe(0);
    expect(cellOpacity(2)).toBe(0);
  });
});
