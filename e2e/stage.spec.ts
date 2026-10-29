import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createZoneRegistry, DEFAULT_FLOORS } from "../src/world/zones";
import type { Vec3 } from "../src/world/zones";
import { boundsCentre, framingBounds, ISO_PITCH, ISO_YAW } from "../src/world/camera";
import { TOKENS, cssVarName, flattenTokens } from "../src/shared/tokens";
import { hexDeltaE, hexToLab } from "../src/shared/color-metrics";
import { SIZE, place, rowV, slotU, swatchCentre } from "../src/world/palette-layout";
import { nexus, waitForHook } from "./nexus";

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

const canvas = (page: Page) => page.locator("[data-testid=scene] canvas");

async function canvasBox(page: Page) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  return box;
}

// Setup waits only: the first software-WebGL frame at 2560x1440 can take well over 5 s when other
// specs run beside this one. These waits decide when to start checking, not what is checked.
const SETUP_TIMEOUT = { timeout: 20_000 };

async function ready(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await expect
    .poll(async () => (await nexus(page, "getCamera")).type, SETUP_TIMEOUT)
    .toBe("OrthographicCamera");
  await expect(page.locator("[data-testid=scene]")).toHaveAttribute(
    "data-revealed",
    "true",
    SETUP_TIMEOUT,
  );
  await expect
    .poll(async () => {
      const { width, height } = await canvasBox(page);
      return [width, height];
    }, SETUP_TIMEOUT)
    .toEqual([size.width, size.height]);
  // Let R3F finish the resize frame so the projection matrix matches the fitted zoom.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

function corners(b: { min: Vec3; max: Vec3 }): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

// One round trip: at 1440p the software-GL render loop keeps the page busy, so each evaluate can take ~1 s.
async function projectAll(page: Page, points: Vec3[]) {
  await waitForHook(page, "project");
  return page.evaluate((pts) => pts.map((p) => window.__nexus!.project!(p)), points);
}

test("ortho camera targets the framing-bounds centre at the iso angle", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await nexus(page, "getCamera")).type).toBe("OrthographicCamera");
  await expect.poll(async () => (await nexus(page, "getCamera")).target).not.toBeNull();
  const cam = await nexus(page, "getCamera");
  const centre = boundsCentre(framingBounds({ zonesOverlay: false }));
  centre.forEach((v, i) => expect(Math.abs(cam.target![i]! - v)).toBeLessThan(0.01));
  const [dx, dy, dz] = cam.direction;
  const deg = (r: number) => (r * 180) / Math.PI;
  expect(Math.abs(deg(Math.atan2(-dx, -dz)) - deg(ISO_YAW))).toBeLessThan(0.1);
  expect(Math.abs(deg(Math.asin(-dy)) - deg(ISO_PITCH))).toBeLessThan(0.1);
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 800, height: 600 },
  { width: 2560, height: 1440 },
]) {
  test(`framing bounds fit and centre at ${size.width}x${size.height}`, async ({ page }) => {
    await page.goto("/");
    await ready(page, size);
    const box = await canvasBox(page);
    const points = await projectAll(page, corners(framingBounds({ zonesOverlay: false })));
    for (const p of points) {
      expect(p.visible).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(box.x);
      expect(p.x).toBeLessThanOrEqual(box.x + box.width);
      expect(p.y).toBeGreaterThanOrEqual(box.y);
      expect(p.y).toBeLessThanOrEqual(box.y + box.height);
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const fillX = (Math.max(...xs) - Math.min(...xs)) / box.width;
    const fillY = (Math.max(...ys) - Math.min(...ys)) / box.height;
    const fill = Math.max(fillX, fillY);
    expect(fill).toBeGreaterThanOrEqual(0.8);
    expect(fill).toBeLessThanOrEqual(0.9);
    const centreX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const centreY = (Math.max(...ys) + Math.min(...ys)) / 2;
    expect(Math.abs(centreX - (box.x + box.width / 2)) / box.width).toBeLessThanOrEqual(0.03);
    expect(Math.abs(centreY - (box.y + box.height / 2)) / box.height).toBeLessThanOrEqual(0.03);
  });
}

test("resizing refits the stage", async ({ page }) => {
  await page.goto("/");
  await ready(page, { width: 1280, height: 720 });
  const before = (await nexus(page, "getCamera")).zoom;
  await ready(page, { width: 800, height: 600 });
  await expect.poll(async () => (await nexus(page, "getCamera")).zoom).toBeLessThan(before);
});

test("the empty stage is one or two draw calls", async ({ page }) => {
  await page.goto("/");
  await ready(page, { width: 1280, height: 720 });
  const { calls } = await nexus(page, "rendererInfo");
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(calls).toBeLessThanOrEqual(2);
});

test("zone overlay is off by default", async ({ page }) => {
  await page.goto("/");
  await ready(page, { width: 1280, height: 720 });
  await expect(page.locator("[data-testid=zone-label]")).toHaveCount(0);
});

test("?zones=1 labels every zone and frames the campus box", async ({ page }) => {
  await page.goto("/?zones=1");
  await ready(page, { width: 2560, height: 1440 });
  const registry = createZoneRegistry({ floors: DEFAULT_FLOORS });
  const labels = page.locator("[data-testid=zone-label]");
  await expect(labels).toHaveCount(registry.zones.length);
  const seen = await labels.evaluateAll((els) =>
    els.map((el) => [el.getAttribute("data-zone-id"), el.textContent]),
  );
  const byZoneId = (a: (string | null)[], b: (string | null)[]) =>
    String(a[0]).localeCompare(String(b[0]));
  expect(seen.sort(byZoneId)).toEqual(registry.zones.map((z) => [z.id, z.name]).sort(byZoneId));
  const box = await canvasBox(page);
  const campus = framingBounds({ zonesOverlay: true });
  for (const p of await projectAll(page, corners(campus))) {
    expect(p.visible).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(box.x);
    expect(p.x).toBeLessThanOrEqual(box.x + box.width);
    expect(p.y).toBeGreaterThanOrEqual(box.y);
    expect(p.y).toBeLessThanOrEqual(box.y + box.height);
  }
  await page.screenshot({ path: "test-results/stage-zones-1440p.png" });
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.locator("[data-testid=zone-label]")).not.toHaveCount(registry.zones.length, {
    timeout: 15_000,
  });
  // Generated by /ship coverage audit (2.1).
  // Value: protects=at 800x600 only tower floors (lobby, floor-N, roof) lose labels; site, garage, bay, rooms keep theirs;
  // fails_when=isTowerFloor widens or narrows, or hideFloors hides every label; why_new=the count check passes for any
  // hidden subset; seam=none; no_claim=label legibility or overlap (ids only)
  const isTower = (id: string) => id === "lobby" || id === "roof" || id.startsWith("floor-");
  await expect
    .poll(
      async () =>
        (
          await labels.evaluateAll((els) =>
            els.map((el) => String(el.getAttribute("data-zone-id"))),
          )
        ).sort(),
      { timeout: 15_000 },
    )
    .toEqual(
      registry.zones
        .map((z) => z.id)
        .filter((id) => !isTower(id))
        .sort(),
    );
  await ready(page, { width: 800, height: 600 });
  await page.screenshot({ path: "test-results/stage-zones-800x600.png" });
});

test.describe("bad floors", () => {
  for (const floors of ["1", "2.5"]) {
    test(`/?floors=${floors} shows the error panel, not a blank page`, async ({ page }) => {
      await page.goto(`/?floors=${floors}`);
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("The 3D view could not start");
      await expect(page.getByTestId("error-detail")).toContainText(`got ${floors}`);
      await expect(page.getByText("Nexus One")).toBeVisible();
      // Only the injected RangeError may reach the console (React's boundary log included).
      expect(errors.length).toBeGreaterThan(0);
      for (const line of errors) expect(line, line).toMatch(/RangeError|floors must be an integer/);
      errors = [];
    });
  }
});

// Generated by /ship coverage audit (2.1).
// Value: protects=a valid dev ?floors=<n> builds the registry with n floors (labels match createZoneRegistry({floors:n}));
// fails_when=Stage ignores ?floors or parses it wrongly; why_new=only bad floors values are tested;
// seam=none; no_claim=production ignoring ?floors (dev server only)
test("?zones=1&floors=3 labels the 3-floor registry", async ({ page }) => {
  await page.goto("/?zones=1&floors=3");
  await ready(page, { width: 2560, height: 1440 });
  const registry = createZoneRegistry({ floors: 3 });
  const labels = page.locator("[data-testid=zone-label]");
  await expect(labels).toHaveCount(registry.zones.length);
  const ids = await labels.evaluateAll((els) =>
    els.map((el) => String(el.getAttribute("data-zone-id"))),
  );
  expect(ids.sort()).toEqual(registry.zones.map((z) => z.id).sort());
  expect(ids).not.toContain("floor-3");
});

// Generated by /ship coverage audit (2.1).
// Value: protects=the error panel's Reload button takes Tab focus, shows a focus ring and reloads the page;
// fails_when=onClick or the focus style is removed; why_new=packaged.spec checks focus only in the packaged lane, and
// nothing clicks Reload; seam=none; no_claim=production build behaviour (dev server only)
test("the error panel's Reload button is focusable and reloads the page", async ({ page }) => {
  await page.goto("/?floors=1");
  const reload = page.getByRole("button", { name: "Reload" });
  await expect(reload).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(reload).toBeFocused();
  // The :focus-visible rule draws a brand-coloured outline; Chromium's default ring is not that colour.
  expect(await reload.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(
    "rgb(159, 176, 200)",
  );
  await page.evaluate(() => Object.assign(window, { __beforeReload: true }));
  await Promise.all([page.waitForEvent("load"), reload.click()]);
  expect(await page.evaluate(() => "__beforeReload" in window)).toBe(false);
  await expect(page.getByRole("alert")).toContainText("The 3D view could not start");
  // Only the injected RangeError may reach the console (React's boundary log included).
  for (const line of errors) expect(line, line).toMatch(/RangeError|floors must be an integer/);
  errors = [];
});

// Generated by /ship coverage audit (2.1).
// Value: protects=main.tsx applies every tokens.ts colour as --nx-* on <html>; fails_when=applyCssTokens() call or a
// token write is dropped; why_new=style.css fallbacks equal the tokens, so no visual test notices; seam=none;
// no_claim=which elements read the variables (covered by tokens-css.test.ts)
test("every token is set as a --nx-* variable on html", async ({ page }) => {
  await page.goto("/");
  const expected = flattenTokens(TOKENS).map(([name, value]) => [cssVarName(name), value]);
  const actual = await page.evaluate(
    (names) => names.map((n) => [n, document.documentElement.style.getPropertyValue(n)]),
    expected.map(([n]) => n!),
  );
  expect(actual).toEqual(expected);
});

test("the default page has no alert", async ({ page }) => {
  await page.goto("/");
  await ready(page, { width: 1280, height: 720 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const reduced of [false, true]) {
  test(`reveal is gated on Stage ready (reduced motion: ${reduced})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.addInitScript(() => {
      const log: { revealed: string | null; opacity: string }[] = [];
      Object.assign(window, { __revealLog: log });
      const record = () => {
        const el = document.querySelector("[data-revealed]");
        const canvas = el?.querySelector("canvas");
        if (!el || !canvas) return;
        const revealed = el.getAttribute("data-revealed");
        if (log.at(-1)?.revealed === revealed) return;
        log.push({ revealed, opacity: getComputedStyle(canvas).opacity });
      };
      new MutationObserver(record).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-revealed"],
      });
    });
    await page.goto("/");
    const scene = page.locator("[data-testid=scene]");
    await expect(scene).toHaveAttribute("data-revealed", "true");
    // The fade's timing is checked as declared CSS, not by timing the machine: under suite load the
    // browser starves for frames and any wall-clock bound on an animation flakes.
    const transition = await scene.locator("canvas").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        property: s.transitionProperty,
        duration: s.transitionDuration,
        easing: s.transitionTimingFunction,
      };
    });
    if (reduced) {
      expect(transition.duration).toBe("0s");
    } else {
      expect(transition).toEqual({
        property: "opacity",
        duration: "0.6s",
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
    }
    // The fade ends fully visible.
    await expect
      .poll(() => scene.locator("canvas").evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    const log = await page.evaluate(
      () =>
        (window as unknown as { __revealLog: { revealed: string; opacity: string }[] }).__revealLog,
    );
    expect(log[0]).toEqual({ revealed: "false", opacity: "0" });
    expect(log.at(-1)?.revealed).toBe("true");
    // Reduced motion shows the canvas instantly; otherwise it is still fading at the first true frame.
    if (reduced) expect(log.at(-1)?.opacity).toBe("1");
  });
}

test("the canvas has an accessible name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("img", { name: "Nexus One campus, isometric view" })).toBeVisible();
});

test("the wordmark uses the brand colour and Instrument Sans", async ({ page }) => {
  await page.goto("/");
  const word = page.getByText("Nexus One", { exact: true });
  await expect(word).toBeVisible();
  const style = await word.evaluate(async (el) => {
    await document.fonts.ready;
    const s = getComputedStyle(el);
    return {
      color: s.color,
      family: s.fontFamily,
      loaded: [...document.fonts].some(
        (f) => f.family.includes("Instrument Sans") && f.status === "loaded",
      ),
    };
  });
  expect(style.color).toBe("rgb(159, 176, 200)");
  expect(style.family.replace(/^"/, "").startsWith("Instrument Sans")).toBe(true);
  expect(style.loaded).toBe(true);
});

test("saves the 1440p screenshot", async ({ page }) => {
  await page.goto("/");
  await ready(page, { width: 2560, height: 1440 });
  await page.screenshot({ path: "test-results/stage-1440p.png" });
});

// ---- Task 2.2: material palette, geometry cache and the ?palette=1 board ----

const HOLD_WARNING = /reveal hold/i;

function watchHoldWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning" && HOLD_WARNING.test(msg.text())) warnings.push(msg.text());
  });
  return warnings;
}

async function materialsAndCache(page: Page) {
  // Bridge mounts after the stage; wait for the scene to hold its materials before reading counts.
  await waitForHook(page, "rendererInfo");
  await waitForHook(page, "cacheStats");
  const info = await nexus(page, "rendererInfo");
  return { info, cache: await nexus(page, "cacheStats") };
}

test("the empty stage has 2 materials, 1 cached geometry and no reveal hold", async ({ page }) => {
  const warnings = watchHoldWarnings(page);
  await page.goto("/");
  await ready(page, { width: 1280, height: 720 });
  const { info, cache } = await materialsAndCache(page);
  expect(info.materials).toBe(2);
  expect(info.programs).toBeGreaterThanOrEqual(1);
  expect(info.programs).toBeLessThanOrEqual(info.materials! + 2);
  expect(cache.size).toBe(1);
  // The hold's timeout is 3 s; wait it out so a stray hold would have fired.
  // gstack-timing-ok: waits out the 3 s hold timer / settle window so a stray warning or late mount would have fired; negative assertion follows.
  await page.waitForTimeout(3500);
  expect(warnings).toEqual([]);
});

// Rendered state recorded at the moment data-revealed first turns true (no late mount, X2 fade).
async function watchBoardReveal(page: Page) {
  await page.addInitScript(() => {
    const seen = {
      labelsAtReveal: -1,
      labelFadeBeforeReveal: null as string | null,
    };
    Object.assign(window, { __boardReveal: seen });
    const check = () => {
      const scene = document.querySelector("[data-testid=scene]");
      if (!scene) return;
      const labels = document.querySelectorAll("[data-testid=palette-label]");
      const revealed = scene.getAttribute("data-revealed") === "true";
      if (!revealed && labels.length > 0 && seen.labelFadeBeforeReveal === null) {
        const root = labels[0]!.closest(".nx-stage > div > *");
        seen.labelFadeBeforeReveal = root ? getComputedStyle(root).opacity : "no fade root";
      }
      if (revealed && seen.labelsAtReveal < 0) {
        seen.labelsAtReveal = labels.length;
      }
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-revealed"],
    });
  });
}

test("?palette=1 shows 11 materials, 5 cached shapes and every labelled swatch at reveal", async ({
  page,
}) => {
  const warnings = watchHoldWarnings(page);
  await watchBoardReveal(page);
  await page.goto("/?palette=1");
  await ready(page, { width: 1440, height: 900 });
  const { info, cache } = await materialsAndCache(page);
  expect(info.materials).toBe(11);
  expect(cache.size).toBe(5);

  // Token names come from the token module, hex values from the app's --nx-* variables.
  const tokens = flattenTokens(TOKENS);
  const live = await page.evaluate(
    (names) => names.map((n) => document.documentElement.style.getPropertyValue(n)),
    tokens.map(([name]) => cssVarName(name)),
  );
  const hexOf = new Map(tokens.map(([name], i) => [name, live[i]!]));
  const slotLabels = [
    ...tokens
      .filter(([name]) => name.startsWith("surface.") || name.startsWith("paint."))
      .map(([name]) => `${name.replace(/^surface\./, "")} ${hexOf.get(name)}`),
    `led ${hexOf.get("surface.trimCyan")}`,
  ];
  expect(slotLabels).toHaveLength(8 + 8 + 1);
  const rows = ["Material palette", "Surfaces", "Vehicle paints", "Together"];
  const shown = await page
    .locator("[data-testid=palette-label]")
    .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  expect(shown.sort()).toEqual([...slotLabels, ...rows].sort());

  const seen = await page.evaluate(
    () =>
      (
        window as unknown as {
          __boardReveal: {
            labelsAtReveal: number;
            labelFadeBeforeReveal: string;
          };
        }
      ).__boardReveal,
  );
  // All swatches (labels mount in the same commit as the meshes) existed when the reveal began.
  expect(seen.labelsAtReveal).toBe(slotLabels.length + rows.length);
  expect(seen.labelFadeBeforeReveal).toBe("0");
  // gstack-timing-ok: waits out the 3 s hold timer / settle window so a stray warning or late mount would have fired; negative assertion follows.
  await page.waitForTimeout(3500);
  expect(warnings).toEqual([]);
});

async function boardStateAfterFailure(page: Page) {
  const { info, cache } = await materialsAndCache(page);
  expect(info.calls).toBeGreaterThanOrEqual(1);
  expect(info.materials).toBe(2);
  expect(cache.size).toBe(1);
  await expect(page.locator("[data-testid=palette-label]")).toHaveCount(0);
}

test("a board module slower than the 3 s hold times out: line, one warning, no late swatches", async ({
  page,
}) => {
  const warnings = watchHoldWarnings(page);
  let arrive!: () => void;
  const gate = new Promise<void>((resolve) => (arrive = resolve));
  await page.route("**/src/debug/PaletteBoard.tsx*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/?palette=1");
  await ready(page, { width: 1280, height: 720 });
  // Revealed while the module is still held back, so the 3 s timeout (not the board) released the hold.
  await expect.poll(() => warnings.length).toBe(1);
  arrive();
  await expect(page.getByTestId("palette-failure")).toHaveText("Palette board timed out");
  await expect(page.getByText("Palette board timed out")).toHaveCount(1);
  await boardStateAfterFailure(page);
  // gstack-timing-ok: waits out the 3 s hold timer / settle window so a stray warning or late mount would have fired; negative assertion follows.
  await page.waitForTimeout(1000);
  await boardStateAfterFailure(page);
  await expect(page.getByText("Palette board timed out")).toHaveCount(1);
  expect(warnings).toHaveLength(1);
});

test("a board module that never loads times out: stage reveals, one warning, no swatches", async ({
  page,
}) => {
  const warnings = watchHoldWarnings(page);
  await page.route("**/src/debug/PaletteBoard.tsx*", () => new Promise<void>(() => {}));
  await page.goto("/?palette=1");
  await ready(page, { width: 1280, height: 720 });
  await expect.poll(() => warnings.length).toBe(1);
  await expect(page.getByText("Palette board timed out")).toHaveCount(1);
  await expect(page.getByTestId("palette-failure")).toHaveText("Palette board timed out");
  await boardStateAfterFailure(page);
  // gstack-timing-ok: waits out the 3 s hold timer / settle window so a stray warning or late mount would have fired; negative assertion follows.
  await page.waitForTimeout(1000);
  await expect(page.getByText("Palette board timed out")).toHaveCount(1);
  expect(warnings).toHaveLength(1);
});

test("a board that throws on render shows the failure line and the stage still runs", async ({
  page,
}) => {
  const warnings = watchHoldWarnings(page);
  await page.route("**/src/debug/PaletteBoard.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export default function PaletteBoard() { throw new Error("forced palette failure"); }',
    }),
  );
  await page.goto("/?palette=1");
  await ready(page, { width: 1280, height: 720 });
  await expect(page.getByTestId("palette-failure")).toHaveText(
    "Palette board failed: forced palette failure",
  );
  await boardStateAfterFailure(page);
  expect(warnings).toEqual([]);
  // Only the injected error (React's and DevBoundary's logs of it) may reach the console.
  expect(errors.length).toBeGreaterThan(0);
  for (const line of errors) expect(line, line).toMatch(/forced palette failure/);
  errors = [];
});

test("?palette=1&zones=1 frames the campus and still renders the board", async ({ page }) => {
  await page.goto("/?palette=1&zones=1");
  await ready(page, { width: 1280, height: 720 });
  const cam = await nexus(page, "getCamera");
  const centre = boundsCentre(framingBounds({ zonesOverlay: true }));
  centre.forEach((v, i) => expect(Math.abs(cam.target![i]! - v)).toBeLessThan(0.01));
  expect(await page.locator("[data-testid=palette-label]").count()).toBeGreaterThan(0);
});

test("?palette=1 hides swatch labels when small and keeps them apart when large", async ({
  page,
}) => {
  const rows = ["Material palette", "Surfaces", "Vehicle paints", "Together"];
  const boxes = async () =>
    page.locator("[data-testid=palette-label]").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
  await page.goto("/?palette=1");
  await ready(page, { width: 375, height: 812 });
  expect((await boxes()).map((b) => b.text).sort()).toEqual([...rows].sort());
  for (const text of rows) await expect(page.getByText(text, { exact: true })).toBeVisible();

  await ready(page, { width: 1440, height: 900 });
  await expect
    .poll(async () => (await boxes()).length, SETUP_TIMEOUT)
    .toBe(8 + 8 + 1 + rows.length);
  const all = await boxes();
  for (const [i, a] of all.entries())
    for (const b of all.slice(i + 1))
      expect(
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
        `${a.text} overlaps ${b.text}`,
      ).toBe(false);
});

// ---- Rendered-pixel checks (eng E2): decode a screenshot inside the page, no Node PNG decoder ----

type Rgb = [number, number, number];

async function readPatches(
  page: Page,
  png: Buffer,
  patches: { x: number; y: number; r: number }[],
): Promise<Rgb[][]> {
  return page.evaluate(
    async ({ b64, list }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = surface.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return list.map((p) => {
        const n = 2 * p.r + 1;
        const data = ctx.getImageData(Math.round(p.x) - p.r, Math.round(p.y) - p.r, n, n).data;
        const out: [number, number, number][] = [];
        for (let i = 0; i < data.length; i += 4) out.push([data[i]!, data[i + 1]!, data[i + 2]!]);
        return out;
      });
    },
    { b64: png.toString("base64"), list: patches },
  );
}

const parseHexRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const meanRgb = (pixels: Rgb[]): Rgb => [
  pixels.reduce((a, p) => a + p[0], 0) / pixels.length,
  pixels.reduce((a, p) => a + p[1], 0) / pixels.length,
  pixels.reduce((a, p) => a + p[2], 0) / pixels.length,
];
const lightness = (rgb: Rgb) => hexToLab(toHex(rgb))[0];

function hsv([r, g, b]: Rgb) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  let hue = 0;
  if (d > 0) {
    if (max === rn) hue = ((gn - bn) / d) % 6;
    else if (max === gn) hue = (bn - rn) / d + 2;
    else hue = (rn - gn) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: max === 0 ? 0 : d / max, value: max };
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const SURFACE_NAMES = [
  "panel",
  "trimCyan",
  "trimWhite",
  "glass",
  "floor",
  "furniture",
  "screenIdle",
  "screenActive",
  "led",
] as const;
const PAINT_NAMES = Object.keys(TOKENS.paint) as (keyof typeof TOKENS.paint)[];

function inside(poly: { x: number; y: number }[], p: { x: number; y: number }) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      hit = !hit;
  }
  return hit;
}

function edgeDistance(poly: { x: number; y: number }[], p: { x: number; y: number }) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2),
    );
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  }
  return best;
}

function hull(points: { x: number; y: number }[]) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list: typeof pts) => {
    const out: typeof pts = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

test("rendered board pixels: trim hue, lightness ceiling, glass lift, paint separation", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/?palette=1");
  await ready(page, { width: 2560, height: 1440 });
  const half = SIZE / 2;
  const surface = (name: (typeof SURFACE_NAMES)[number]) =>
    swatchCentre("surfaces", SURFACE_NAMES.indexOf(name));
  const at = (name: (typeof SURFACE_NAMES)[number], dx: number, y: number, dz: number): Vec3 => {
    const [x, , z] = surface(name);
    return [x + dx, y, z + dz];
  };

  // Probe points, one projection round trip.
  const probes: { key: string; world: Vec3 }[] = [];
  const add = (key: string, world: Vec3) => probes.push({ key, world });
  // Trim edge: the top edge of the +x face, midpoint.
  add("trimCyan-edge", at("trimCyan", half, SIZE, 0));
  add("trimWhite-edge", at("trimWhite", half, SIZE, 0));
  // Lit faces: top, +x and +z face centres of every cube swatch.
  const cubes: { label: string; centre: Vec3 }[] = [
    ...(["panel", "trimCyan", "trimWhite", "floor", "furniture"] as const).map((n) => ({
      label: n,
      centre: surface(n),
    })),
    ...PAINT_NAMES.map((n, i) => ({ label: `paint.${n}`, centre: swatchCentre("paints", i) })),
  ];
  for (const { label, centre } of cubes) {
    const [x, , z] = centre;
    add(`${label}|top`, [x, SIZE, z]);
    add(`${label}|+x`, [x + half, half, z]);
    add(`${label}|+z`, [x, half, z + half]);
  }
  // Glass: pane quad corners and a grid on the backer's visible faces.
  const row = rowV("surfaces");
  const u3 = slotU("surfaces", SURFACE_NAMES.indexOf("glass"));
  for (const du of [-half, half])
    for (const dv of [-0.1, 0.1])
      for (const y of [0, SIZE])
        add(`pane|${du}|${dv}|${y}`, place(u3 - 0.6 + du, row + 0.8 + dv, y));
  const [bx, , bz] = place(u3 + 0.2, row - 2.2);
  const GRID = 9;
  for (const face of ["+x", "+z"] as const) {
    for (let i = 0; i < GRID; i++)
      for (let j = 0; j < GRID; j++) {
        const t = -half + 0.2 + ((SIZE - 0.4) * i) / (GRID - 1);
        const y = 0.2 + ((SIZE - 0.4) * j) / (GRID - 1);
        add(
          `backer|${face}|${i}|${j}`,
          face === "+x" ? [bx + half, y, bz + t] : [bx + t, y, bz + half],
        );
      }
  }
  const projected = await projectAll(
    page,
    probes.map((p) => p.world),
  );
  const screen = new Map(probes.map((p, i) => [p.key, projected[i]!]));
  const point = (key: string) => screen.get(key)!;

  const png = await page.screenshot();
  const radius = (key: string) => (key.endsWith("-edge") ? 5 : key.startsWith("backer") ? 1 : 2);
  const patches = await readPatches(
    page,
    png,
    probes.map((p) => ({ x: point(p.key).x, y: point(p.key).y, r: radius(p.key) })),
  );
  const patchOf = new Map(probes.map((p, i) => [p.key, patches[i]!]));
  const mean = (key: string) => meanRgb(patchOf.get(key)!);
  const report = (what: string, value: string) => console.log(`MEASURED ${what}: ${value}`);

  // Trim edges: the brightest pixel of the window around the edge midpoint is the bar's core.
  const core = (key: string) =>
    patchOf.get(key)!.reduce((best, px) => (hsv(px).value > hsv(best).value ? px : best));
  const cyanToken = hsv(parseHexRgb(TOKENS.surface.trimCyan));
  const cyan = hsv(core("trimCyan-edge"));
  report(
    "trimCyan edge",
    `hue ${cyan.hue.toFixed(1)} (token ${cyanToken.hue.toFixed(1)}), saturation ${cyan.saturation.toFixed(2)}`,
  );
  expect(hueGap(cyan.hue, cyanToken.hue)).toBeLessThanOrEqual(10);
  expect(cyan.saturation).toBeGreaterThan(0.3);
  // trimWhite is near-neutral, so hue is meaningless: its core must be light (L* >= 60) and
  // keep the token's cool tint (HSV saturation below 0.2, blue the strongest channel).
  const whiteRgb = core("trimWhite-edge");
  const white = hsv(whiteRgb);
  report(
    "trimWhite edge",
    `L* ${lightness(whiteRgb).toFixed(1)}, saturation ${white.saturation.toFixed(2)}, rgb ${whiteRgb.join(",")}`,
  );
  expect(lightness(whiteRgb)).toBeGreaterThanOrEqual(60);
  expect(white.saturation).toBeLessThan(0.2);
  expect(whiteRgb[2]).toBeGreaterThanOrEqual(Math.max(whiteRgb[0], whiteRgb[1]));

  // No lit surface face above L* 90 except silver.
  const faces = cubes.flatMap(({ label }) =>
    ["top", "+x", "+z"].map((f) => ({ key: `${label}|${f}`, silver: label === "paint.silver" })),
  );
  const lit = faces.filter((f) => !f.silver).map((f) => [f.key, lightness(mean(f.key))] as const);
  const brightest = lit.reduce((a, b) => (b[1] > a[1] ? b : a));
  report("brightest non-silver face", `${brightest[0]} L* ${brightest[1].toFixed(1)}`);
  report(
    "silver faces L*",
    ["top", "+x", "+z"].map((f) => lightness(mean(`paint.silver|${f}`)).toFixed(1)).join(", "),
  );
  for (const [key, l] of lit) expect(l, key).toBeLessThanOrEqual(90);

  // Glass: backer samples under the pane's screen quad against the same face outside it.
  const pane = hull(
    probes
      .filter((p) => p.key.startsWith("pane|"))
      .map((p) => ({ x: point(p.key).x, y: point(p.key).y })),
  );
  const MARGIN = 8;
  const deltas: number[] = [];
  for (const face of ["+x", "+z"]) {
    const covered: number[] = [];
    const open: number[] = [];
    for (const p of probes.filter((q) => q.key.startsWith(`backer|${face}|`))) {
      const pt = point(p.key);
      const l = lightness(meanRgb(patchOf.get(p.key)!));
      const d = edgeDistance(pane, pt);
      if (d < MARGIN) continue;
      (inside(pane, pt) ? covered : open).push(l);
    }
    report(`glass backer ${face}`, `${covered.length} covered, ${open.length} open`);
    if (covered.length < 3 || open.length < 3) continue;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = avg(covered) - avg(open);
    report(
      `glass lift ${face}`,
      `+${delta.toFixed(2)} L* (covered ${avg(covered).toFixed(1)}, open ${avg(open).toFixed(1)})`,
    );
    deltas.push(delta);
  }
  expect(deltas.length).toBeGreaterThan(0);
  for (const delta of deltas) {
    expect(delta).toBeGreaterThanOrEqual(4);
    expect(delta).toBeLessThanOrEqual(10);
  }

  // Paint separation as rendered: top-face centres.
  const paints = PAINT_NAMES.map((n) => toHex(mean(`paint.${n}|top`)));
  const minima = { normal: Infinity, deutan: Infinity, protan: Infinity };
  for (let a = 0; a < paints.length; a++)
    for (let b = a + 1; b < paints.length; b++) {
      for (const kind of ["normal", "deutan", "protan"] as const) {
        const de = hexDeltaE(paints[a]!, paints[b]!, kind === "normal" ? undefined : kind);
        if (de < minima[kind]) minima[kind] = de;
        const floor = kind === "normal" ? 10 : 5;
        expect(de, `${PAINT_NAMES[a]} vs ${PAINT_NAMES[b]} (${kind})`).toBeGreaterThanOrEqual(
          floor,
        );
      }
    }
  report("paint rendered hexes", paints.join(" "));
  report(
    "paint min dE2000",
    `normal ${minima.normal.toFixed(1)}, deutan ${minima.deutan.toFixed(1)}, protan ${minima.protan.toFixed(1)}`,
  );
  await page.screenshot({ path: "test-results/palette-board-2560x1440.png" });
});

test("saves the palette board 1440x900 screenshot", async ({ page }) => {
  await page.goto("/?palette=1");
  await ready(page, { width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/palette-board-1440x900.png" });
});

test("saves the palette board campus-zoom screenshot", async ({ page }) => {
  await page.goto("/?palette=1&zones=1");
  await ready(page, { width: 2560, height: 1440 });
  await page.screenshot({ path: "test-results/palette-board-campus.png" });
});
