import { PALETTE_BOUNDS } from "./palette-layout";
import { LOOK } from "./stage-look";
import {
  DEFAULT_FLOORS,
  FLOOR_HEIGHT,
  FOOTPRINTS,
  createZoneRegistry,
  type Box,
  type Vec3,
} from "./zones";

export const ISO_PITCH = Math.atan(1 / Math.SQRT2);
export const ISO_YAW = Math.PI / 4;

export type ViewBasis = { direction: Vec3; right: Vec3; up: Vec3; groundEdgePxPerZoom: number };

// Yaw of dev view k (`?view=0..3`): view 0 is the default iso view, each step turns the camera 90 degrees.
export const viewYaw = (view: number) => ISO_YAW + (view * Math.PI) / 2;

// Camera basis from one yaw (camera in the +x/+z quadrant at yaw 45 degrees) and the fixed iso pitch.
// `direction` is the unit vector from the camera to its target; `groundEdgePxPerZoom` is the projected
// length in px of a 1 m ground edge per unit of zoom (x and z edges project equally at 45 degree yaws).
export function viewBasis(yaw: number): ViewBasis {
  const [sy, cy, sp, cp] = [Math.sin(yaw), Math.cos(yaw), Math.sin(ISO_PITCH), Math.cos(ISO_PITCH)];
  const right: Vec3 = [cy, 0, -sy];
  const up: Vec3 = [-sp * sy, cp, -sp * cy];
  return {
    direction: [-cp * sy, -sp, -cp * cy],
    right,
    up,
    groundEdgePxPerZoom: Math.hypot(right[0], up[0]),
  };
}

export function isoDirection(): Vec3 {
  return viewBasis(ISO_YAW).direction;
}

// Projected length in px of a 1 m ground edge per unit of zoom at every dev view.
export const GROUND_EDGE_PX_PER_ZOOM = viewBasis(ISO_YAW).groundEdgePxPerZoom;

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

const boxCorners = (box: Box): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
  return out;
};

// The tower box: its footprint from the ground to the roof top.
export function towerBox(floors: number): Box {
  const { x, z } = FOOTPRINTS.tower;
  return { min: [x[0], 0, z[0]], max: [x[1], (floors + 1) * FLOOR_HEIGHT, z[1]] };
}

// Points the zoom must fit and the centre they are fitted around (the camera target). The default
// framing keeps the slab centre and fits slab plus tower corners; zones and palette fit their own box.
export function framingPoints({
  zonesOverlay,
  floors = DEFAULT_FLOORS,
  palette = false,
}: {
  zonesOverlay: boolean;
  floors?: number;
  palette?: boolean;
}): { centre: Vec3; points: Vec3[] } {
  const bounds = framingBounds({ zonesOverlay, floors, palette });
  const points = boxCorners(bounds);
  if (!zonesOverlay && !palette) points.push(...boxCorners(towerBox(floors)));
  return { centre: boundsCentre(bounds), points };
}

// Fraction of the viewport kept empty around the fitted framing.
export const FIT_MARGIN = 0.15;

// Zoom (px per metre) that fits the points into the viewport around `centre` for the view at `yaw`,
// or null for a zero-size viewport (the caller keeps the previous zoom).
export function fitPointsZoom(
  points: readonly Vec3[],
  centre: Vec3,
  viewport: { width: number; height: number },
  margin = FIT_MARGIN,
  yaw = ISO_YAW,
): number | null {
  if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
  const { right, up } = viewBasis(yaw);
  let halfX = 0;
  let halfY = 0;
  for (const p of points) {
    const rel: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    halfX = Math.max(halfX, Math.abs(dot(rel, right)));
    halfY = Math.max(halfY, Math.abs(dot(rel, up)));
  }
  return Math.min(viewport.width / (2 * halfX), viewport.height / (2 * halfY)) * (1 - margin);
}

// Zoom that fits the box into the viewport, centred on the box centre.
export function fitZoom(
  bounds: Box,
  viewport: { width: number; height: number },
  margin = FIT_MARGIN,
  yaw = ISO_YAW,
): number | null {
  return fitPointsZoom(boxCorners(bounds), boundsCentre(bounds), viewport, margin, yaw);
}

// The box corner nearest the camera for the view at `yaw` (camera above, in the quadrant of its yaw).
export function nearestCorner(box: Box, yaw: number): Vec3 {
  return [
    Math.sin(yaw) > 0 ? box.max[0] : box.min[0],
    box.max[1],
    Math.cos(yaw) > 0 ? box.max[2] : box.min[2],
  ];
}

// 1 at or above `gridFadeFromPx`, 0 at or below `gridFadeToPx`, linear between.
export function cellOpacity(projectedCellPx: number): number {
  const { gridFadeFromPx: from, gridFadeToPx: to } = LOOK;
  return Math.min(1, Math.max(0, (projectedCellPx - to) / (from - to)));
}

// Exact decimal integer dev param in [min, max]; `fallback` when the param is absent. "", "06", "6.0",
// " 6" and "0x6" all fail the pattern (Number() would accept them), so they throw like out-of-range values.
export function readDevInt(
  params: URLSearchParams,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${raw}`);
  }
  return value;
}

// Key light direction (unit, from the scene towards the light) for the view at `yaw`: `LOOK.key.direction`
// turned about the vertical axis by the same angle as the camera, so every view is lit the same way.
export function keyLightDirection(yaw: number): Vec3 {
  const [x, y, z] = LOOK.key.direction;
  const turn = yaw - ISO_YAW;
  const [s, c] = [Math.sin(turn), Math.cos(turn)];
  const v: Vec3 = [x * c + z * s, y, -x * s + z * c];
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

// Directional-light shadow camera for the campus box at `floors` (tower height included), as seen from the
// light at `distance` along `keyLightDirection(yaw)` and looking at the origin. Tight to the box, so texels
// are not spent on floors that do not exist. `margin` pads every side in metres.
export function keyShadowFrustum(
  floors: number,
  yaw: number,
  margin = 1,
): {
  distance: number;
  near: number;
  far: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const dir = keyLightDirection(yaw);
  // Same basis three's lookAt builds for a light at +dir looking at the origin: x = Y cross dir, y = dir cross x.
  const xLen = Math.hypot(dir[2], dir[0]);
  const lx: Vec3 = [dir[2] / xLen, 0, -dir[0] / xLen];
  const ly: Vec3 = [
    dir[1] * lx[2] - dir[2] * lx[1],
    dir[2] * lx[0] - dir[0] * lx[2],
    dir[0] * lx[1] - dir[1] * lx[0],
  ];
  const box = framingBounds({ zonesOverlay: true, floors });
  const points = boxCorners(box);
  const distance = Math.max(...points.map((p) => Math.hypot(...p))) + margin;
  let [left, right, bottom, top, near, far] = [
    Infinity,
    -Infinity,
    Infinity,
    -Infinity,
    Infinity,
    -Infinity,
  ];
  for (const p of points) {
    const depth = distance - dot(p, dir);
    left = Math.min(left, dot(p, lx));
    right = Math.max(right, dot(p, lx));
    bottom = Math.min(bottom, dot(p, ly));
    top = Math.max(top, dot(p, ly));
    near = Math.min(near, depth);
    far = Math.max(far, depth);
  }
  return {
    distance,
    near: Math.max(0.1, near - margin),
    far: far + margin,
    left: left - margin,
    right: right + margin,
    top: top + margin,
    bottom: bottom - margin,
  };
}
