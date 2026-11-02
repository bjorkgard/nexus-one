import { describe, expect, it } from "vite-plus/test";
import { shadowPending, shadowSettled, stageReady } from "./ready-gate";

const ready = {
  fitted: true,
  cameraActive: true,
  holdStatus: "released" as const,
  shadowPending: false,
};

describe("stageReady", () => {
  it("is ready when fitted, active, released and no shadow update is pending", () => {
    expect(stageReady(ready)).toBe(true);
  });

  it("is ready after a hold timeout", () => {
    expect(stageReady({ ...ready, holdStatus: "timedOut" })).toBe(true);
  });

  it.each([
    ["not fitted", { fitted: false }],
    ["another camera active", { cameraActive: false }],
    ["hold pending", { holdStatus: "pending" as const }],
    ["shadow render still pending", { shadowPending: true }],
  ])("waits while %s", (_name, patch) => {
    expect(stageReady({ ...ready, ...patch })).toBe(false);
  });
});

describe("shadowSettled", () => {
  it("is settled when nothing was requested", () => {
    expect(shadowSettled({ requested: false, needsUpdate: false })).toBe(true);
  });

  it("is pending while the renderer has not consumed the request", () => {
    expect(shadowSettled({ requested: true, needsUpdate: true })).toBe(false);
  });

  it("is settled once the renderer cleared needsUpdate after a request", () => {
    expect(shadowSettled({ requested: true, needsUpdate: false })).toBe(true);
  });
});

describe("shadowPending", () => {
  const base = { towerVisible: true, enabled: true, requested: true, needsUpdate: false };

  it("is not pending once the requested update was consumed", () => {
    expect(shadowPending(base)).toBe(false);
  });

  it.each([
    ["nothing requested yet", { requested: false }],
    ["the renderer has not consumed the request", { needsUpdate: true }],
  ])("is pending while %s", (_name, patch) => {
    expect(shadowPending({ ...base, ...patch })).toBe(true);
  });

  it.each([
    ["there is no tower", { towerVisible: false, requested: false }],
    ["the shadow map is disabled", { enabled: false, requested: true, needsUpdate: true }],
  ])("is not pending when %s", (_name, patch) => {
    expect(shadowPending({ ...base, ...patch })).toBe(false);
  });
});
