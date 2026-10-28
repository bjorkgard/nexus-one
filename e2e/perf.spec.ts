import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { nexus } from "./nexus";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
});

test.afterEach(() => {
  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

// The overlay mounts lazily; its stats canvas proves the chunk, the store link and the listener are live.
async function openPage(page: Page, url = "/") {
  await page.goto(url);
  const overlay = page.locator("[data-testid=perf-overlay]");
  await overlay.waitFor({ state: "attached" });
  await overlay.locator("canvas").first().waitFor({ state: "attached" });
  return overlay;
}

test("backtick toggles the overlay", async ({ page }) => {
  const overlay = await openPage(page);
  await expect(overlay).toBeHidden();
  await page.keyboard.press("Backquote");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator("canvas").first()).toBeVisible();
  await page.keyboard.press("Backquote");
  await expect(overlay).toBeHidden();
});

test("three toggles leave one stats container", async ({ page }) => {
  const overlay = await openPage(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backquote");
  await expect(overlay).toBeVisible();
  await expect(page.locator("[data-testid=perf-host] > div")).toHaveCount(1);
});

test("probe box shows up in rendererInfo and in the panel", async ({ page }) => {
  const overlay = await openPage(page, "/?probe=box");
  await page.keyboard.press("Backquote");
  await expect(overlay).toBeVisible();
  await expect
    .poll(async () => {
      const info = await nexus(page, "rendererInfo");
      return info.calls >= 1 && info.triangles >= 12;
    })
    .toBe(true);
  // The panel samples at 4 Hz; the scene is static, so its values settle on rendererInfo's.
  const info = await nexus(page, "rendererInfo");
  await expect(page.locator("[data-testid=perf-calls]")).toHaveText(String(info.calls));
  await expect(page.locator("[data-testid=perf-triangles]")).toHaveText(String(info.triangles));
});

test("stats timing entries stay bounded", async ({ page }) => {
  await openPage(page);
  // 0 ms frames make stats-gl re-mark cpu-started inside resetCounters (stats-gl/dist/main.js:186-190).
  const sample = () =>
    page.evaluate(() => ({
      started: performance.getEntriesByName("cpu-started").length,
      finished: performance.getEntriesByName("cpu-finished").length,
      duration: performance.getEntriesByName("cpu-duration").length,
    }));
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(2000);
    const counts = await sample();
    expect(counts.started).toBeLessThanOrEqual(2);
    expect(counts.finished).toBeLessThanOrEqual(1);
    expect(counts.duration).toBeLessThanOrEqual(1);
  }
});

test("overlay canvases stay static after a resize", async ({ page }) => {
  const overlay = await openPage(page);
  await page.keyboard.press("Backquote");
  await expect(overlay).toBeVisible();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.locator("[data-testid=scene] canvas")).toHaveJSProperty("clientWidth", 800);
  const positions = await overlay
    .locator("canvas")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
  expect(positions.length).toBeGreaterThan(0);
  expect(positions.every((p) => p === "static")).toBe(true);
});
