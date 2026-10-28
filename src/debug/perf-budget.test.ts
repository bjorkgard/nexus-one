import { describe, expect, it } from "vite-plus/test";
import { PERF_BUDGET, drawCallLevel } from "./perf-budget";

describe("PERF_BUDGET", () => {
  it("holds the plan budget", () => {
    expect(PERF_BUDGET).toEqual({ drawCalls: 300, fps: 60 });
  });
});

describe("drawCallLevel", () => {
  it.each([
    [0, "ok"],
    [239, "ok"],
    [240, "warn"],
    [299, "warn"],
    [300, "over"],
    [301, "over"],
  ] as const)("%i draw calls is %s", (calls, level) => {
    expect(drawCallLevel(calls)).toBe(level);
  });
});
