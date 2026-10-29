import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createZoneRegistry, DEFAULT_FLOORS } from "../src/world/zones";
import type { Vec3 } from "../src/world/zones";
import { boundsCentre, framingBounds, ISO_PITCH, ISO_YAW } from "../src/world/camera";
import { TOKENS, cssVarName, flattenTokens } from "../src/shared/tokens";
import { nexus, waitForHook } from "./nexus";

// Each test drives a software-WebGL render up to 2560x1440; running them in parallel saturates the CPU
// and makes timing assertions flaky, so this file's tests run one at a time.
test.describe.configure({ mode: "serial" });

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

async function ready(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await expect.poll(async () => (await nexus(page, "getCamera")).type).toBe("OrthographicCamera");
  await expect(page.locator("[data-testid=scene]")).toHaveAttribute("data-revealed", "true");
  await expect
    .poll(async () => {
      const { width, height } = await canvasBox(page);
      return [width, height];
    })
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
      // Page-clock timestamps: the fade's duration is measured where it runs, not in the busy test runner.
      const fade = { shownAt: 0, endedAt: 0 };
      Object.assign(window, { __revealLog: log, __fade: fade });
      document.addEventListener(
        "transitionend",
        (e) => {
          if (e.target instanceof HTMLCanvasElement && e.propertyName === "opacity") {
            fade.endedAt = performance.now();
          }
        },
        true,
      );
      const record = () => {
        const el = document.querySelector("[data-revealed]");
        const canvas = el?.querySelector("canvas");
        if (!el || !canvas) return;
        const revealed = el.getAttribute("data-revealed");
        if (log.at(-1)?.revealed === revealed) return;
        if (revealed === "true") fade.shownAt = performance.now();
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
    if (!reduced) {
      // Wait for the opacity transition to finish, then check it took at most 1 s on the page's own clock.
      await page.waitForFunction(
        () => (window as unknown as { __fade: { endedAt: number } }).__fade.endedAt > 0,
      );
      const { shownAt, endedAt } = await page.evaluate(
        () => (window as unknown as { __fade: { shownAt: number; endedAt: number } }).__fade,
      );
      expect(endedAt - shownAt).toBeLessThanOrEqual(1000);
    }
    expect(await scene.locator("canvas").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
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
