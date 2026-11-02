import { describe, expect, it } from "vite-plus/test";
import { OrthographicCamera, Vector3 } from "three";
import {
  ISO_PITCH,
  ISO_YAW,
  GROUND_EDGE_PX_PER_ZOOM,
  cameraRig,
  cellOpacity,
  fitPointsZoom,
  fitZoom,
  framingBounds,
  framingPoints,
  isoDirection,
  keyLightDirection,
  keyShadowFrustum,
  nearestCorner,
  readDevInt,
  viewBasis,
  viewYaw,
} from "./camera";
import { LAYOUT_SEED, buildLayout } from "./layout";
import { LOOK } from "./stage-look";
import { PALETTE_BOUNDS } from "./palette-layout";
import { buildTower } from "./tower";
import { createZoneRegistry, DEFAULT_FLOORS, MAX_FLOORS, type Box, type Vec3 } from "./zones";

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

  it("frames the palette board box with palette, and zones wins over palette", () => {
    expect(framingBounds({ zonesOverlay: false, palette: true })).toEqual(PALETTE_BOUNDS);
    const campus = createZoneRegistry({ floors: DEFAULT_FLOORS }).byId("campus")!.box;
    expect(framingBounds({ zonesOverlay: true, palette: true })).toEqual(campus);
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

describe("viewBasis", () => {
  it("view 0 equals the fixed iso constants", () => {
    const b = viewBasis(viewYaw(0));
    const expected = [
      [-1 / Math.sqrt(3), -1 / Math.sqrt(3), -1 / Math.sqrt(3)],
      RIGHT,
      UP,
    ] as const;
    [b.direction, b.right, b.up].forEach((v, i) =>
      v.forEach((c, j) => expect(c).toBeCloseTo(expected[i]![j]!, 12)),
    );
    expect(b.groundEdgePxPerZoom).toBeCloseTo(Math.hypot(RIGHT[0], UP[0]), 12);
    expect(GROUND_EDGE_PX_PER_ZOOM).toBeCloseTo(Math.hypot(RIGHT[0], UP[0]), 12);
  });

  it.each([0, 1, 2, 3])("view %i basis is orthonormal", (view) => {
    const { direction, right, up, groundEdgePxPerZoom } = viewBasis(viewYaw(view));
    for (const v of [direction, right, up]) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    expect(dot(direction, right)).toBeCloseTo(0, 12);
    expect(dot(direction, up)).toBeCloseTo(0, 12);
    expect(dot(right, up)).toBeCloseTo(0, 12);
    expect(groundEdgePxPerZoom).toBeCloseTo(GROUND_EDGE_PX_PER_ZOOM, 12);
  });

  it("view 1 turns the camera 90 degrees: it sits at (+x, -z)", () => {
    expect(viewBasis(viewYaw(1)).direction[0]).toBeLessThan(0);
    expect(viewBasis(viewYaw(1)).direction[2]).toBeGreaterThan(0);
  });
});

describe("nearestCorner", () => {
  const box: Box = { min: [-1, 0, -2], max: [3, 5, 4] };
  it.each([
    [0, [3, 5, 4]],
    [1, [3, 5, -2]],
    [2, [-1, 5, -2]],
    [3, [-1, 5, 4]],
  ])("view %i", (view, corner) => {
    expect(nearestCorner(box, viewYaw(view))).toEqual(corner);
  });
});

describe("framing with the tower", () => {
  const viewports = [
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 },
    { width: 720, height: 1280 },
  ];
  it.each(viewports)("default floors zoom equals slab-only zoom at $width x $height", (vp) => {
    for (const view of [0, 1, 2, 3]) {
      const { centre, points } = framingPoints({ zonesOverlay: false, floors: DEFAULT_FLOORS });
      expect(fitPointsZoom(points, centre, vp, 0.15, viewYaw(view))).toBeCloseTo(
        fitZoom(bounds, vp, 0.15, viewYaw(view))!,
        9,
      );
    }
  });

  it.each([0, 1, 2, 3])("floors 40 fits all points in view %i", (view) => {
    const vp = { width: 1280, height: 720 };
    const { centre, points } = framingPoints({ zonesOverlay: false, floors: MAX_FLOORS });
    const yaw = viewYaw(view);
    const zoom = fitPointsZoom(points, centre, vp, 0.15, yaw)!;
    const { right, up } = viewBasis(yaw);
    for (const p of points) {
      const rel: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
      expect(Math.abs(dot(rel, right)) * zoom).toBeLessThanOrEqual(vp.width / 2 + 1e-9);
      expect(Math.abs(dot(rel, up)) * zoom).toBeLessThanOrEqual(vp.height / 2 + 1e-9);
    }
    expect(zoom).toBeLessThan(fitZoom(bounds, vp, 0.15, yaw)!);
  });

  it("zones and palette framing fit their own box", () => {
    const vp = { width: 1280, height: 720 };
    for (const opts of [{ zonesOverlay: true }, { zonesOverlay: false, palette: true }]) {
      const { centre, points } = framingPoints(opts);
      expect(fitPointsZoom(points, centre, vp)).toBeCloseTo(fitZoom(framingBounds(opts), vp)!, 9);
    }
  });
});

describe("readDevInt", () => {
  const read = (qs: string, name = "view") => readDevInt(new URLSearchParams(qs), name, 0, 3, 0);
  it("returns the fallback when absent and exact decimals in range", () => {
    expect(read("")).toBe(0);
    expect(read("view=0")).toBe(0);
    expect(read("view=3")).toBe(3);
    expect(readDevInt(new URLSearchParams("floors=40"), "floors", 2, 40, 6)).toBe(40);
  });

  it.each([
    "view=",
    // In-range after Number(), so only the exact-decimal pattern rejects them.
    "view=03",
    "view=3.0",
    "view=%203",
    "view=0x3",
    "view=4",
    "view=-1",
    "view=1.5",
  ])("rejects %s", (qs) => {
    expect(() => read(qs)).toThrow(RangeError);
  });

  it.each(["floors=06", "floors=6.0", "floors=%206", "floors=0x6"])("rejects %s", (qs) => {
    expect(() => readDevInt(new URLSearchParams(qs), "floors", 2, 40, 6)).toThrow(RangeError);
  });

  it("keeps the floors message format", () => {
    expect(() => readDevInt(new URLSearchParams("floors=2.5"), "floors", 2, 40, 6)).toThrow(
      "floors must be an integer in [2, 40], got 2.5",
    );
  });
});

describe("key light turns with the view", () => {
  it("is LOOK.key.direction, normalised, at view 0", () => {
    const d = new Vector3(...LOOK.key.direction).normalize();
    const got = keyLightDirection(viewYaw(0));
    expect(got[0]).toBeCloseTo(d.x, 12);
    expect(got[1]).toBeCloseTo(d.y, 12);
    expect(got[2]).toBeCloseTo(d.z, 12);
  });

  it.each([1, 2, 3])("view %i keeps elevation and the angle to the camera", (view) => {
    const base = keyLightDirection(viewYaw(0));
    const turned = keyLightDirection(viewYaw(view));
    expect(turned[1]).toBeCloseTo(base[1], 12);
    expect(Math.hypot(...turned)).toBeCloseTo(1, 12);
    // Camera and light turn together: the light's right/forward components in the camera frame do not change.
    const a = viewBasis(viewYaw(0));
    const b = viewBasis(viewYaw(view));
    expect(dot(turned, b.right)).toBeCloseTo(dot(base, a.right), 12);
    expect(dot(turned, b.direction)).toBeCloseTo(dot(base, a.direction), 12);
  });
});

describe("keyShadowFrustum", () => {
  // Top corners of every roof instance (parapet, cyan bar, AC): each is a unit box placed by its matrix.
  const towerRoofCorners = (floors: number): Vec3[] =>
    buildTower({ floors, openings: buildLayout({ floors, seed: LAYOUT_SEED }).openings })
      .parts.filter((p) => p.kind === "parapet" || p.kind === "parapetEdge" || p.kind === "ac")
      .flatMap((p) => p.matrices)
      .flatMap((m) =>
        [-0.5, 0.5].flatMap((x) =>
          [-0.5, 0.5].map((z) => new Vector3(x, 0.5, z).applyMatrix4(m).toArray() as Vec3),
        ),
      );

  it.each([2, 6, 40])(
    "floors %i: campus box and roof parts lie inside the frustum in every view",
    (floors) => {
      for (const view of [0, 1, 2, 3]) {
        const yaw = viewYaw(view);
        const f = keyShadowFrustum(floors, yaw);
        const dir = keyLightDirection(yaw);
        const cam = new OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far);
        cam.position.set(dir[0] * f.distance, dir[1] * f.distance, dir[2] * f.distance);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();
        const box = framingBounds({ zonesOverlay: true, floors });
        const roof = towerRoofCorners(floors);
        expect(roof).toHaveLength(4 * (4 + 4 + 3));
        for (const c of [...corners(box), ...roof]) {
          const ndc = new Vector3(...c).project(cam);
          for (const v of [ndc.x, ndc.y, ndc.z]) {
            expect(v).toBeGreaterThanOrEqual(-1);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    },
  );

  it("is fitted to the current floors, not MAX_FLOORS", () => {
    const small = keyShadowFrustum(2, ISO_YAW);
    const big = keyShadowFrustum(MAX_FLOORS, ISO_YAW);
    expect(small.far - small.near).toBeLessThan(big.far - big.near);
    expect(small.top - small.bottom).toBeLessThan(big.top - big.bottom);
  });

  it("keeps the near plane in front of the light", () => {
    for (const floors of [2, 6, 40]) {
      for (const view of [0, 1, 2, 3]) {
        const f = keyShadowFrustum(floors, viewYaw(view));
        expect(f.near).toBeGreaterThan(0);
        expect(f.far).toBeGreaterThan(f.near);
      }
    }
  });
});
