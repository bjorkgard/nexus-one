import { PALETTE_BOUNDS } from "./palette-layout";
import { LOOK } from "./stage-look";
import { DEFAULT_FLOORS, createZoneRegistry, type Box, type Vec3 } from "./zones";

export const ISO_PITCH = Math.atan(1 / Math.SQRT2);
export const ISO_YAW = Math.PI / 4;

// Unit vector from the camera to its target; the camera sits in the (+x, +y, +z) octant.
export function isoDirection(): Vec3 {
  const s = 1 / Math.sqrt(3);
  return [-s, -s, -s];
}

const RIGHT: Vec3 = [Math.SQRT1_2, 0, -Math.SQRT1_2];
const UP: Vec3 = [-1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6)];

// Projected length in px of a 1 m ground edge per unit of zoom (x and z edges project equally).
export const GROUND_EDGE_PX_PER_ZOOM = Math.hypot(RIGHT[0], UP[0]);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function boundsCentre(bounds: Box): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

// What the camera frames: the slab, the campus box when the dev zone overlay is on, or the palette
// board box when `?palette=1` is on (zones wins over palette).
export function framingBounds({
  zonesOverlay,
  floors = DEFAULT_FLOORS,
  palette = false,
}: {
  zonesOverlay: boolean;
  floors?: number;
  palette?: boolean;
}): Box {
  if (zonesOverlay) return createZoneRegistry({ floors }).byId("campus")!.box;
  if (palette) return PALETTE_BOUNDS;
  const half = LOOK.slabSize / 2;
  return { min: [-half, -LOOK.slabThickness, -half], max: [half, 0, half] };
}

export function cameraRig(bounds: Box): { distance: number; near: number; far: number } {
  const diagonal = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  return { distance: diagonal, near: 0.1, far: 2 * diagonal };
}

// Zoom (px per metre) that fits the box into the viewport, centred on the box centre, or null for a
// zero-size viewport (the caller keeps the previous zoom).
export function fitZoom(
  bounds: Box,
  viewport: { width: number; height: number },
  margin = 0.15,
): number | null {
  if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
  const centre = boundsCentre(bounds);
  let halfX = 0;
  let halfY = 0;
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const rel: Vec3 = [x - centre[0], y - centre[1], z - centre[2]];
        halfX = Math.max(halfX, Math.abs(dot(rel, RIGHT)));
        halfY = Math.max(halfY, Math.abs(dot(rel, UP)));
      }
  return Math.min(viewport.width / (2 * halfX), viewport.height / (2 * halfY)) * (1 - margin);
}

// 1 at or above `gridFadeFromPx`, 0 at or below `gridFadeToPx`, linear between.
export function cellOpacity(projectedCellPx: number): number {
  const { gridFadeFromPx: from, gridFadeToPx: to } = LOOK;
  return Math.min(1, Math.max(0, (projectedCellPx - to) / (from - to)));
}
