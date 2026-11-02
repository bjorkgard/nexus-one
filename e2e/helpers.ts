import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Vec3 } from "../src/world/zones";
import { nexus, waitForHook } from "./nexus";

export const canvas = (page: Page) => page.locator("[data-testid=scene] canvas");

export async function canvasBox(page: Page) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  return box;
}

// Setup waits only: the first software-WebGL frame at 2560x1440 can take well over 5 s when other
// specs run beside this one. These waits decide when to start checking, not what is checked.
export const SETUP_TIMEOUT = { timeout: 20_000 };

export async function ready(page: Page, size: { width: number; height: number }) {
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

// One round trip: at 1440p the software-GL render loop keeps the page busy, so each evaluate can take ~1 s.
export async function projectAll(page: Page, points: Vec3[]) {
  await waitForHook(page, "project");
  return page.evaluate((pts) => pts.map((p) => window.__nexus!.project!(p)), points);
}

export type Rgb = [number, number, number];

export async function readPatches(
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

export const meanRgb = (pixels: Rgb[]): Rgb => [
  pixels.reduce((a, p) => a + p[0], 0) / pixels.length,
  pixels.reduce((a, p) => a + p[1], 0) / pixels.length,
  pixels.reduce((a, p) => a + p[2], 0) / pixels.length,
];

// The 600 ms reveal fade has ended: pixels read after this are settled.
export async function fadeSettled(page: Page) {
  await expect
    .poll(() => canvas(page).evaluate((el) => getComputedStyle(el).opacity), SETUP_TIMEOUT)
    .toBe("1");
}
