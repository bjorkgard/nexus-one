import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { nexus, waitForHook } from "./nexus";

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

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  return box;
}

test("page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await expect(page.getByText("Nexus One")).toBeVisible();
  const box = await canvasBox(page);
  const viewport = page.viewportSize();
  expect(box.width).toBe(viewport?.width);
  expect(box.height).toBe(viewport?.height);
});

test("hooks are registered", async ({ page }) => {
  await page.goto("/");
  await waitForHook(page, "rendererInfo");
  const keys = await page.evaluate(() => Object.keys(window.__nexus ?? {}).sort());
  expect(keys).toEqual(["getCamera", "project", "rendererInfo"]);
});

test("rendererInfo returns finite numbers", async ({ page }) => {
  await page.goto("/");
  const info = await nexus(page, "rendererInfo");
  for (const key of ["calls", "triangles", "geometries", "textures"] as const) {
    expect(Number.isFinite(info[key]), key).toBe(true);
  }
});

test("getCamera returns plain data", async ({ page }) => {
  await page.goto("/");
  const cam = await nexus(page, "getCamera");
  expect(typeof cam.type).toBe("string");
  expect(cam.type.length).toBeGreaterThan(0);
  expect(cam.position).toHaveLength(3);
  expect(cam.position.every(Number.isFinite)).toBe(true);
  expect(cam.projectionMatrix).toHaveLength(16);
  expect(cam.projectionMatrix.every(Number.isFinite)).toBe(true);
});

test("project maps origin to canvas center, also after resize", async ({ page }) => {
  await page.goto("/");
  const expectCentered = async () => {
    const box = await canvasBox(page);
    const p = await nexus(page, "project", [0, 0, 0]);
    expect(p.visible).toBe(true);
    expect(Math.abs(p.x - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
  };
  await expectCentered();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => {
      const { width, height } = await canvasBox(page);
      return [width, height];
    })
    .toEqual([800, 600]);
  await expectCentered();
});

test("waitForHook timeout names the hook", async ({ page }) => {
  await page.goto("about:blank");
  await expect(waitForHook(page, "getCamera", 500)).rejects.toThrow(
    "hook getCamera not registered within 0.5s",
  );
});
