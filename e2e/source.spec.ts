import { expect, test } from "@playwright/test";
import { nexus, waitForHook } from "./nexus";

let errors: string[] = [];
let expectedRefusal: string | null = null;

test.beforeEach(async ({ page }) => {
  errors = [];
  expectedRefusal = null;
  page.on("console", (msg) => {
    if (msg.type() === "error" && !(expectedRefusal && msg.text().includes(expectedRefusal)))
      errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
});

test.afterEach(() => {
  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

async function openPage(page: import("@playwright/test").Page, url = "/") {
  await page.goto(url);
  await waitForHook(page, "dataState");
  await expect.poll(async () => (await nexus(page, "dataState")).status).toBe("open");
}

test("default page uses the mock source and its clock advances", async ({ page }) => {
  await openPage(page);
  const first = await nexus(page, "dataState");
  expect(first.source).toBe("mock");
  expect(first.clock).not.toBeNull();
  await expect
    .poll(async () => (await nexus(page, "dataState")).clock ?? 0)
    .toBeGreaterThan(first.clock ?? 0);
});

test("emit applies a valid new session_start", async ({ page }) => {
  await openPage(page);
  const before = await nexus(page, "dataState");
  const event = {
    id: "e2e-ev-1",
    ts: 1,
    type: "session_start",
    sessionId: "e2e-session-1",
    projectId: "e2e-project-1",
    projectName: "e2e",
    provider: "claude",
  };
  await nexus(page, "emit", event);
  const applied = await nexus(page, "dataState");
  // The mock source emits on its own timer, so lastEventId and an exact session count can race;
  // prove the first emit was applied by the re-sent id counting as exactly one duplicate.
  expect(applied.counts.sessions).toBeGreaterThanOrEqual(before.counts.sessions + 1);
  await nexus(page, "emit", event);
  const after = await nexus(page, "dataState");
  expect(after.counters.duplicates).toBe(applied.counters.duplicates + 1);
  expect(after.counters.rejected).toBe(applied.counters.rejected);
});

test("emit rejects an invalid object", async ({ page }) => {
  await openPage(page);
  await expect(nexus(page, "emit", { nope: true })).rejects.toThrow(/invalid event/);
});

test("setClock moves forward and seeks backward", async ({ page }) => {
  await openPage(page);
  const start = await nexus(page, "dataState");
  const first = start.clock ?? 0;
  const target = first + 60_000;
  await nexus(page, "setClock", target);
  const forward = await nexus(page, "dataState");
  expect(forward.clock ?? 0).toBeGreaterThanOrEqual(target);

  expect(forward.counts.sessions).toBeGreaterThan(start.counts.sessions);

  // Backward seek to the first event's ts: rebuild in a new epoch, status back to open.
  await nexus(page, "setClock", first);
  await expect.poll(async () => (await nexus(page, "dataState")).status).toBe("open");
  const back = await nexus(page, "dataState");
  expect(back.counters.reconnects).toBe(start.counters.reconnects + 1);
  expect(back.counts).toEqual(start.counts);

  // Seeking forward again replays to the same state as before.
  await nexus(page, "setClock", target);
  const again = await nexus(page, "dataState");
  expect(again.counts).toEqual(forward.counts);
});

test("unknown source falls back to mock", async ({ page }) => {
  await openPage(page, "/?source=foo");
  expect((await nexus(page, "dataState")).source).toBe("mock");
});

// Value: protects=?source=live selects the live transport, and setClock is refused without the mock; fails_when=boot ignores source=live or setClock stops throwing for live; why_new=every other spec runs the mock source; seam=none; no_claim=a real collector connection (none listens on the port)
test("source=live selects live and setClock needs the mock", async ({ page }) => {
  // Nothing listens on this port: Chrome logs each refused connection (backoff retries too) as a
  // console error naming the URL, so ignore only that URL for this test's lifetime.
  expectedRefusal = "ws://127.0.0.1:47999";
  await page.goto("/?source=live&port=47999");
  await waitForHook(page, "dataState");
  const state = await nexus(page, "dataState");
  expect(state.source).toBe("live");
  expect(state.clock).toBeNull();
  await expect(nexus(page, "setClock", 1)).rejects.toThrow(/needs \?source=mock/);
});
