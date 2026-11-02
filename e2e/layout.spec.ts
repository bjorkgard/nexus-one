import { expect, test } from "@playwright/test";
import { createZoneRegistry, DEFAULT_FLOORS } from "../src/world/zones";
import { roomLabelAnchor } from "../src/debug/zone-filter";
import { projectAll, ready, SETUP_TIMEOUT } from "./helpers";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
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

const registry = createZoneRegistry({ floors: DEFAULT_FLOORS });
const rooms = registry.zones.flatMap((z) => (z.kind === "room" ? [z] : []));

const labelIds = (page: import("@playwright/test").Page) =>
  page
    .locator("[data-testid=zone-label]")
    .evaluateAll((els) => els.map((el) => String(el.getAttribute("data-zone-id"))));

const edgeIds = async (page: import("@playwright/test").Page) =>
  (
    (await page.locator("[data-testid=zone-edges]").getAttribute("data-zone-ids", SETUP_TIMEOUT)) ??
    ""
  )
    .split(" ")
    .filter(Boolean);

test("plain ?zones=1 draws no room edges", async ({ page }) => {
  await page.goto("/?zones=1");
  await ready(page, { width: 2560, height: 1440 });
  const ids = await edgeIds(page);
  expect(ids).toContain("campus");
  expect(ids.filter((id) => rooms.some((r) => r.id === id))).toEqual([]);
});

test("?zones=1&floor=1 draws exactly floor 1's room edges", async ({ page }) => {
  await page.goto("/?zones=1&floor=1");
  await ready(page, { width: 2560, height: 1440 });
  const ids = await edgeIds(page);
  const roomEdges = ids.filter((id) => rooms.some((r) => r.id === id)).toSorted();
  expect(roomEdges).toEqual(
    rooms
      .filter((r) => r.floor === 1)
      .map((r) => r.id)
      .toSorted(),
  );
  expect(roomEdges.length).toBeGreaterThan(0);
});

test("?zones=1&floor=1 pins each room label at its room's centre", async ({ page }) => {
  await page.goto("/?zones=1&floor=1");
  await ready(page, { width: 2560, height: 1440 });
  const onFloor = rooms.filter((r) => r.floor === 1);
  const expected = onFloor.filter((r) => r.roomType !== "corridor").length + 1;
  await expect
    .poll(
      async () => (await labelIds(page)).filter((id) => onFloor.some((r) => r.id === id)).length,
    )
    .toBe(expected);
  // One read of ids and rects together, so a label cannot change between them.
  const seen = await page.locator("[data-testid=zone-label]").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: String(el.getAttribute("data-zone-id")), x: r.x, y: r.y };
    }),
  );
  const shown = seen.flatMap((l) =>
    onFloor.filter((r) => r.id === l.id).map((room) => ({ room, l })),
  );
  expect(shown.length).toBe(expected);
  const points = await projectAll(
    page,
    shown.map((s) => roomLabelAnchor(s.room)),
  );
  for (const [i, { room, l }] of shown.entries()) {
    // The pill's top-left corner sits on the projected anchor.
    expect(Math.abs(l.x - points[i]!.x), `${room.id} x`).toBeLessThan(4);
    expect(Math.abs(l.y - points[i]!.y), `${room.id} y`).toBeLessThan(4);
  }
});

test("?zones=1&floor=1 hides other floors' level labels", async ({ page }) => {
  await page.goto("/?zones=1&floor=1");
  await ready(page, { width: 2560, height: 1440 });
  await expect(page.locator("[data-testid=zone-label][data-zone-id=floor-1]")).toHaveCount(1);
  await expect(page.locator("[data-testid=zone-label][data-zone-id=floor-2]")).toHaveCount(0);
  await expect(page.locator("[data-testid=zone-label][data-zone-id=lobby]")).toHaveCount(0);
  await expect(page.locator("[data-testid=zone-label][data-zone-id=campus]")).toHaveCount(1);
});

test("plain ?zones=1 shows no room labels", async ({ page }) => {
  await page.goto("/?zones=1");
  await ready(page, { width: 2560, height: 1440 });
  await expect(page.locator("[data-testid=zone-label]")).not.toHaveCount(0);
  const ids = await labelIds(page);
  expect(ids.filter((id) => rooms.some((r) => r.id === id))).toEqual([]);
});

for (const floor of [0, 1, DEFAULT_FLOORS]) {
  test(`?zones=1&floor=${floor} labels exactly floor ${floor}'s rooms, one corridor label`, async ({
    page,
  }) => {
    await page.goto(`/?zones=1&floor=${floor}`);
    await ready(page, { width: 2560, height: 1440 });
    const onFloor = rooms.filter((r) => r.floor === floor);
    const expectedPlain = onFloor.filter((r) => r.roomType !== "corridor").map((r) => r.id);
    const corridors = onFloor.filter((r) => r.roomType === "corridor");
    await expect(page.locator("[data-testid=zone-label]")).not.toHaveCount(0);
    await expect
      .poll(
        async () => (await labelIds(page)).filter((id) => rooms.some((r) => r.id === id)).length,
      )
      .toBe(expectedPlain.length + (corridors.length > 0 ? 1 : 0));
    const shown = (await labelIds(page)).filter((id) => rooms.some((r) => r.id === id));
    const shownRooms = shown.map((id) => rooms.find((r) => r.id === id)!);
    expect(shownRooms.every((r) => r.floor === floor)).toBe(true);
    expect(shownRooms.filter((r) => r.roomType === "corridor")).toHaveLength(
      corridors.length > 0 ? 1 : 0,
    );
    // Every room type present on the floor carries a label.
    for (const type of new Set(onFloor.map((r) => r.roomType))) {
      expect(
        shownRooms.some((r) => r.roomType === type),
        `${type} labelled on floor ${floor}`,
      ).toBe(true);
    }
  });
}

test.describe("bad floor", () => {
  for (const floor of ["abc", "-1", String(DEFAULT_FLOORS + 1)]) {
    test(`/?zones=1&floor=${floor} shows the error panel`, async ({ page }) => {
      await page.goto(`/?zones=1&floor=${floor}`);
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("The 3D view could not start");
      await expect(page.getByTestId("error-detail")).toContainText(`got ${floor}`);
      await expect(page.getByTestId("error-detail")).toContainText(
        `floor must be an integer in [0, ${DEFAULT_FLOORS}]`,
      );
      expect(errors.length).toBeGreaterThan(0);
      for (const line of errors) expect(line, line).toMatch(/RangeError|floor must be an integer/);
      errors = [];
    });
  }
});

test("?floor=1 without ?zones=1 shows no zone labels", async ({ page }) => {
  await page.goto("/?floor=1");
  await ready(page, { width: 1280, height: 720 });
  await expect(page.locator("[data-testid=zone-label]")).toHaveCount(0);
});
