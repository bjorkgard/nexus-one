import { describe, expect, it } from "vite-plus/test";
import { shadowSettled, stageReady } from "./ready-gate";

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
