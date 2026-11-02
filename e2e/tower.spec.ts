import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buildTower, floorTopY, GLASS_HALF } from "../src/world/tower";
import { keyLightDirection, viewYaw } from "../src/world/camera";
import { LOOK } from "../src/world/stage-look";
import { DEFAULT_FLOORS, FLOOR_HEIGHT, FOOTPRINTS } from "../src/world/zones";
import type { Vec3 } from "../src/world/zones";
import { nexus } from "./nexus";
import {
  canvasBox,
  fadeSettled,
  meanRgb,
  projectAll,
  readPatches,
  ready,
  SETUP_TIMEOUT,
  type Rgb,
} from "./helpers";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    // R3F 9.8.2 creates a THREE.Clock, which three 0.186 deprecates; nothing in this repo can fix it.
    if (msg.text().startsWith("THREE.Clock: This module has been deprecated")) return;
    if (msg.type() === "warning" && /^(THREE\.|WebGL)/.test(msg.text())) {
      errors.push(`console.warn: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
});

test.afterEach(() => {
  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

// Measured weakest gain is about 30 of 255 luma; 10 leaves room for the machine and still fails without the strip.
const MIN_GLOW_GAIN = 10;
const QHD = { width: 2560, height: 1440 };
const VIEWS = [0, 1, 2, 3] as const;
const report = (what: string, value: string) => console.log(`MEASURED ${what}: ${value}`);
// Rec. 709 luma on 0-255 channels: enough to rank "brighter" without a colour model.
const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Opens `url` at 2560x1440 and returns once the reveal fade has ended, so pixels are settled.
async function openSettled(page: Page, url: string, size = QHD) {
  await page.goto(url);
  await ready(page, size);
  await fadeSettled(page);
}

// Patch means (3x3 by default) of the screenshot at each world point's projection.
async function patchMeans(page: Page, png: Buffer, points: Vec3[], r = 1) {
  const projected = await projectAll(page, points);
  const patches = await readPatches(
    page,
    png,
    projected.map((p) => ({ x: p.x, y: p.y, r })),
  );
  return { projected, means: patches.map(meanRgb) };
}

// Which two facades face the camera: the signs of its offset from the tower on x and z.
async function visibleSides(page: Page): Promise<{ sx: number; sz: number }> {
  const cam = await nexus(page, "getCamera");
  return { sx: Math.sign(cam.position[0]), sz: Math.sign(cam.position[2]) };
}

// The strip's centre line sits half a strip width inside its outer edge (tower.ts GLOW_OUTER_HALF).
const GLOW_MID_HALF = GLASS_HALF - LOOK.tower.glowInset - LOOK.tower.glowWidth / 2;
// Clear of the mullions at +-3 and +-9 and of the corner posts.
const ALONG = [-12, -6, 0, 6, 12];
const CORNER_BACK = 0.6;

function glowPoints(floors: number, sx: number, sz: number) {
  const points: { label: string; world: Vec3 }[] = [];
  for (let k = 0; k < floors; k++) {
    const y = floorTopY(k) + LOOK.tower.glowLift;
    for (const t of ALONG) {
      points.push({ label: `floor ${k} +x face ${t}`, world: [sx * GLOW_MID_HALF, y, t] });
      points.push({ label: `floor ${k} +z face ${t}`, world: [t, y, sz * GLOW_MID_HALF] });
    }
    // The mitred corner itself hides behind the corner post (measured gain 0), so the corner is sampled
    // `CORNER_BACK` along each arm from it, where the strip is in the clear.
    const back = GLOW_MID_HALF - CORNER_BACK;
    points.push({
      label: `floor ${k} corner, +x arm`,
      world: [sx * GLOW_MID_HALF, y, sz * back],
    });
    points.push({
      label: `floor ${k} corner, +z arm`,
      world: [sx * back, y, sz * GLOW_MID_HALF],
    });
  }
  return points;
}

for (const view of VIEWS) {
  test(`view ${view}: screenshot, and the floor glow brightens every sampled point`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openSettled(page, `/?view=${view}`);
    const png = await page.screenshot({ path: `test-results/tower-view-${view}.png` });
    const { sx, sz } = await visibleSides(page);
    const samples = glowPoints(DEFAULT_FLOORS, sx, sz);
    const world = samples.map((s) => s.world);
    const lit = await patchMeans(page, png, world);

    await openSettled(page, `/?view=${view}&glow=0`);
    const dark = await page.screenshot({ path: `test-results/tower-view-${view}-noglow.png` });
    const off = await patchMeans(page, dark, world);

    const box = await canvasBox(page);
    // Same view, same camera: every point projects to the same pixel in both renders.
    lit.projected.forEach((p, i) => {
      expect(Math.abs(p.x - off.projected[i]!.x), samples[i]!.label).toBeLessThan(0.01);
      expect(p.visible).toBe(true);
      expect(p.x).toBeGreaterThan(box.x);
      expect(p.x).toBeLessThan(box.x + box.width);
      expect(p.y).toBeGreaterThan(box.y);
      expect(p.y).toBeLessThan(box.y + box.height);
    });
    const gains = samples.map((s, i) => ({
      label: s.label,
      gain: luma(lit.means[i]!) - luma(off.means[i]!),
    }));
    const weakest = gains.reduce((a, b) => (b.gain < a.gain ? b : a));
    report(
      `view ${view} glow gain (luma, 0-255)`,
      `weakest ${weakest.label} +${weakest.gain.toFixed(1)}`,
    );
    for (const { label, gain } of gains) expect(gain, label).toBeGreaterThanOrEqual(MIN_GLOW_GAIN);
  });
}

// Ground points for the shadow check: one inside the tower's shadow and one in the light, both on the ground,
// outside the footprint and not hidden behind the tower from the camera. `direction` is the camera's view direction.
function shadowProbes(floors: number, view: number, direction: Vec3) {
  const light = keyLightDirection(viewYaw(view));
  const roofY = floors * FLOOR_HEIGHT;
  const reach = [-light[0] * (roofY / light[1]), -light[2] * (roofY / light[1])] as const;
  const half = FOOTPRINTS.tower.x[1]!;
  const inSquare = (x: number, z: number, m: number) =>
    Math.abs(x) <= half + m && Math.abs(z) <= half + m;
  // A box casts the shadow of its footprint swept along `reach`.
  const shadowed = (x: number, z: number, m: number) => {
    for (let t = 0; t <= 1; t += 0.02)
      if (inSquare(x - t * reach[0], z - t * reach[1], m)) return true;
    return false;
  };
  const hidden = (x: number, z: number) => {
    for (let s = 0; s * -direction[1] <= roofY; s += 0.25) {
      if (inSquare(x - s * direction[0], z - s * direction[2], 1)) return true;
    }
    return false;
  };
  const y = LOOK.gridLift + 0.01;
  const inShadow: [number, number][] = [];
  const inLight: [number, number][] = [];
  // Half a metre off the integer grid lines, so the patches see plain ground.
  for (let x = -49.5; x <= 50; x += 2) {
    for (let z = -49.5; z <= 50; z += 2) {
      if (inSquare(x, z, 1) || hidden(x, z)) continue;
      if (shadowed(x, z, -3)) inShadow.push([x, z]);
      else if (!shadowed(x, z, 3)) inLight.push([x, z]);
    }
  }
  const byDistance = (a: [number, number], b: [number, number]) =>
    Math.hypot(...a) - Math.hypot(...b);
  const dark = inShadow.sort(byDistance)[0];
  if (!dark) throw new Error(`no unhidden shadowed ground at ${floors} floors, view ${view}`);
  const near = (c: [number, number]) => Math.abs(Math.hypot(...c) - Math.hypot(...dark));
  const light1 = inLight.sort((a, b) => near(a) - near(b))[0];
  if (!light1) throw new Error(`no unhidden lit ground at ${floors} floors, view ${view}`);
  return { shadowed: [dark[0], y, dark[1]] as Vec3, lit: [light1[0], y, light1[1]] as Vec3 };
}

test("shadow is present after reveal, and shadows on/off screenshots are saved", async ({
  page,
}) => {
  test.setTimeout(180_000);
  let probes: { shadowed: Vec3; lit: Vec3 };
  const measure = async (png: Buffer) => {
    const { shadowed, lit } = probes;
    const { projected, means } = await patchMeans(page, png, [shadowed, lit], 3);
    for (const p of projected) expect(p.visible).toBe(true);
    return luma(means[0]!) / luma(means[1]!);
  };
  await openSettled(page, "/");
  probes = shadowProbes(DEFAULT_FLOORS, 0, (await nexus(page, "getCamera")).direction);
  const on = await measure(await page.screenshot({ path: "test-results/tower-shadows-on.png" }));
  report("shadowed/lit ground luma ratio, shadows on", on.toFixed(3));
  // Measured 0.18: the shadowed ground is about a fifth as bright as the lit ground.
  expect(on).toBeLessThan(0.7);

  // Same scene with the key light's shadow intensity forced to 0: the map is still drawn (so the ready gate and the exposure are the same), nothing is darkened.
  await page.route("**/src/world/Stage.tsx*", async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const body = original.replace(
      "castShadow: towerVisible,",
      'castShadow: towerVisible, "shadow-intensity": 0,',
    );
    expect(body, "Stage.tsx shadow patch applied").not.toBe(original);
    await route.fulfill({ response, body });
  });
  await openSettled(page, "/");
  const off = await measure(await page.screenshot({ path: "test-results/tower-shadows-off.png" }));
  report("shadowed/lit ground luma ratio, shadows off", off.toFixed(3));
  // Measured 1.00: with the shadow off the two patches are equally lit.
  expect(Math.abs(off - 1)).toBeLessThan(0.2);
});

test("shadow is redrawn after the WebGL context is lost and restored", async ({ page }) => {
  test.setTimeout(180_000);
  await openSettled(page, "/");
  const { shadowed, lit } = shadowProbes(
    DEFAULT_FLOORS,
    0,
    (await nexus(page, "getCamera")).direction,
  );
  const ratio = async () => {
    const { projected, means } = await patchMeans(
      page,
      await page.screenshot(),
      [shadowed, lit],
      3,
    );
    for (const p of projected) expect(p.visible).toBe(true);
    return luma(means[0]!) / luma(means[1]!);
  };
  expect(await ratio()).toBeLessThan(0.7);
  // One page call: getExtension returns null once the context is lost, so the extension object is kept.
  await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=scene] canvas");
    const gl = canvas?.getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!canvas || !ext) throw new Error("WEBGL_lose_context unavailable");
    const once = (name: string) =>
      new Promise<void>((resolve) =>
        canvas.addEventListener(name, () => resolve(), { once: true }),
      );
    const lost = once("webglcontextlost");
    ext.loseContext();
    await lost;
    // Chrome allows restoreContext only after the lost event has been fully dispatched.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const restored = once("webglcontextrestored");
    ext.restoreContext();
    await restored;
  });
  // Let three re-initialise and draw a few frames; the redrawn map must again darken the shadowed patch.
  await expect.poll(ratio, { timeout: 15_000 }).toBeLessThan(0.7);
});

for (const floors of [2, 40]) {
  test(`?floors=${floors} saves a screenshot with the tower, its shadow and no errors`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openSettled(page, `/?floors=${floors}`);
    await expect(
      page.getByRole("img", {
        name: `Nexus One campus: glass office tower, ${floors} floors, isometric view`,
      }),
    ).toBeVisible();
    const png = await page.screenshot({ path: `test-results/tower-floors-${floors}.png` });
    const { shadowed, lit } = shadowProbes(floors, 0, (await nexus(page, "getCamera")).direction);
    const { projected, means } = await patchMeans(page, png, [shadowed, lit], 3);
    for (const p of projected) expect(p.visible).toBe(true);
    const ratio = luma(means[0]!) / luma(means[1]!);
    report(`?floors=${floors} shadowed/lit ground luma ratio`, ratio.toFixed(3));
    expect(ratio).toBeLessThan(0.7);
  });
}

test("?palette=1 has no tower: the 2.2 board counts and the generic name stand", async ({
  page,
}) => {
  await page.goto("/?palette=1");
  await ready(page, { width: 1440, height: 900 });
  const info = await nexus(page, "rendererInfo");
  expect(info.materials).toBe(11);
  expect((await nexus(page, "cacheStats")).size).toBe(5);
  await expect(page.getByRole("img", { name: "Nexus One campus, isometric view" })).toBeVisible();
});

// ---- AC unit labels (?zones=1) ----

const AC_UNITS = buildTower({ floors: DEFAULT_FLOORS }).acUnits;

for (const view of VIEWS) {
  test(`?zones=1 view ${view}: 3 AC labels, inside the canvas, anchored at their units`, async ({
    page,
  }) => {
    await page.goto(`/?zones=1&view=${view}`);
    await ready(page, QHD);
    const labels = page.locator("[data-testid=ac-label]");
    // drei Html mounts over several frames: wait for the count, not a read.
    await expect(labels).toHaveCount(AC_UNITS.length, SETUP_TIMEOUT);
    const box = await canvasBox(page);
    const projected = await projectAll(
      page,
      AC_UNITS.map((u) => u.position),
    );
    const rects = await labels.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(rects.map((r) => r.text).sort()).toEqual(AC_UNITS.map((u) => u.name).sort());
    AC_UNITS.forEach((unit, i) => {
      const rect = rects.find((r) => r.text === unit.name)!;
      // An Html label's top-left corner sits on the projected anchor.
      expect(Math.abs(rect.x - projected[i]!.x), unit.name).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.y - projected[i]!.y), unit.name).toBeLessThanOrEqual(1);
      expect(rect.x).toBeGreaterThanOrEqual(box.x);
      expect(rect.y).toBeGreaterThanOrEqual(box.y);
      expect(rect.x + rect.w).toBeLessThanOrEqual(box.x + box.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(box.y + box.height);
    });
  });
}

// The overlay is mounted once its zone labels exist, so a zero AC count after that is a hidden label, not a late mount.
const zoneLabelsMounted = (page: Page) =>
  expect
    .poll(() => page.locator("[data-testid=zone-label]").count(), SETUP_TIMEOUT)
    .toBeGreaterThan(0);

test("?palette=1&zones=1 has no tower, so no AC labels", async ({ page }) => {
  await page.goto("/?palette=1&zones=1");
  await ready(page, QHD);
  await zoneLabelsMounted(page);
  await expect(page.locator("[data-testid=ac-label]")).toHaveCount(0);
});

test("?zones=1&floors=40 hides the AC labels like the tower floor labels", async ({ page }) => {
  await page.goto("/?zones=1&floors=40");
  await ready(page, QHD);
  await zoneLabelsMounted(page);
  await expect(page.locator("[data-testid=ac-label]")).toHaveCount(0);
});
