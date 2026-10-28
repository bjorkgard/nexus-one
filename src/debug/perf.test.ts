import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  instances: [] as {
    init: ReturnType<typeof vi.fn>;
    begin: ReturnType<typeof vi.fn>;
    handleResize: () => void;
  }[],
  initError: null as Error | null,
}));

vi.mock("stats-gl", () => ({
  default: class {
    handleResize = () => {};
    begin = vi.fn();
    init = vi.fn(async (gl: { render: () => void }) => {
      if (mocks.initError) throw mocks.initError;
      const original = gl.render;
      gl.render = () => {
        this.begin();
        original();
      };
    });
    constructor() {
      mocks.instances.push(this);
    }
  },
}));

import {
  acquirePerfStats,
  clearStatsEntries,
  createInfoSampler,
  guardFrame,
  isProbeEnabled,
  isToggleKey,
  usePerfStore,
} from "./perf";

const PERF_KEY = Symbol.for("nexus.perfStats");

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.initError = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  usePerfStore.setState({ visible: false, stats: null, info: null });
});

describe("usePerfStore", () => {
  it("starts hidden and toggles", () => {
    expect(usePerfStore.getState().visible).toBe(false);
    usePerfStore.getState().toggle();
    expect(usePerfStore.getState().visible).toBe(true);
    usePerfStore.getState().toggle();
    expect(usePerfStore.getState().visible).toBe(false);
  });
});

const key = (over: Record<string, unknown> = {}) => ({
  code: "Backquote",
  key: "`",
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: null,
  ...over,
});

describe("isToggleKey", () => {
  it.each([
    ["plain backtick", key(), true],
    ["code Backquote, key Dead", key({ key: "Dead" }), true],
    ["key backtick on another code", key({ code: "Digit1" }), true],
    [
      "Swedish dead backtick (Shift + ´)",
      key({ code: "Equal", key: "Dead", shiftKey: true }),
      true,
    ],
    ["Swedish dead acute (´ without Shift)", key({ code: "Equal", key: "Dead" }), false],
    ["unrelated key", key({ code: "KeyA", key: "a" }), false],
    ["repeat", key({ repeat: true }), false],
    ["meta", key({ metaKey: true }), false],
    ["ctrl", key({ ctrlKey: true }), false],
    ["alt", key({ altKey: true }), false],
    ["input target", key({ target: { tagName: "INPUT" } }), false],
    ["textarea target", key({ target: { tagName: "TEXTAREA" } }), false],
    ["select target", key({ target: { tagName: "SELECT" } }), false],
    ["contentEditable target", key({ target: { tagName: "DIV", isContentEditable: true } }), false],
    ["div target", key({ target: { tagName: "DIV", isContentEditable: false } }), true],
  ])("%s", (_name, event, expected) => {
    expect(isToggleKey(event)).toBe(expected);
  });
});

describe("isProbeEnabled", () => {
  it.each([
    ["?probe=box", true],
    ["?probe=Box", false],
    ["?probe=", false],
    ["", false],
    ["?x=box", false],
    ["?probe=box&a=1", true],
  ])("%j is %s", (search, expected) => {
    expect(isProbeEnabled(search)).toBe(expected);
  });
});

describe("guardFrame", () => {
  it("runs fn with its arguments", () => {
    const fn = vi.fn();
    guardFrame(fn, "part")(1, 2);
    expect(fn).toHaveBeenCalledWith(1, 2);
  });

  it("logs the first throw once, then is a no-op", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    const fn = vi.fn(() => {
      throw err;
    });
    const guarded = guardFrame(fn, "part");
    expect(() => guarded()).not.toThrow();
    guarded();
    guarded();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("part", err);
  });
});

function fakeGl() {
  const original = vi.fn();
  return { render: original, original } as unknown as Parameters<typeof acquirePerfStats>[0] & {
    original: ReturnType<typeof vi.fn>;
  };
}

describe("acquirePerfStats", () => {
  it("returns one instance for two acquires and inits once", () => {
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    const gl = fakeGl();
    const a = acquirePerfStats(gl);
    const b = acquirePerfStats(gl);
    expect(a.stats).toBe(b.stats);
    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0]?.init).toHaveBeenCalledTimes(1);
  });

  it("two renderers get two instances", () => {
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    const a = acquirePerfStats(fakeGl());
    const b = acquirePerfStats(fakeGl());
    expect(a.stats).not.toBe(b.stats);
  });

  it("last release restores render, removes the resize listener and clears the symbol", () => {
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { removeEventListener });
    const gl = fakeGl();
    const original = gl.render;
    const a = acquirePerfStats(gl);
    const b = acquirePerfStats(gl);
    expect(gl.render).not.toBe(original);
    a.release();
    expect(gl.render).not.toBe(original);
    expect(removeEventListener).not.toHaveBeenCalled();
    b.release();
    expect(gl.render).toBe(original);
    expect(removeEventListener).toHaveBeenCalledWith("resize", mocks.instances[0]?.handleResize);
    expect(PERF_KEY in gl).toBe(false);
  });

  it("a second release from one handle is ignored", () => {
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    const gl = fakeGl();
    const a = acquirePerfStats(gl);
    const b = acquirePerfStats(gl);
    a.release();
    a.release();
    expect(PERF_KEY in gl).toBe(true);
    b.release();
    expect(PERF_KEY in gl).toBe(false);
  });

  it("a later acquire creates a fresh instance and wraps render once", () => {
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    const gl = fakeGl();
    const original = gl.render;
    const first = acquirePerfStats(gl);
    first.release();
    const second = acquirePerfStats(gl);
    expect(second.stats).not.toBe(first.stats);
    expect(mocks.instances).toHaveLength(2);
    gl.render({} as never, {} as never);
    expect(gl.original).toHaveBeenCalledTimes(1);
    expect(mocks.instances[0]?.begin).not.toHaveBeenCalled();
    expect(mocks.instances[1]?.begin).toHaveBeenCalledTimes(1);
    second.release();
    expect(gl.render).toBe(original);
  });

  it("logs an init rejection", async () => {
    vi.stubGlobal("window", { removeEventListener: vi.fn() });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("init failed");
    mocks.initError = err;
    acquirePerfStats(fakeGl());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).toHaveBeenCalledWith("PerfStats init", err);
  });
});

describe("clearStatsEntries", () => {
  const fakePerf = () => ({ clearMeasures: vi.fn(), clearMarks: vi.fn() });

  it("clears all three names when not profiling", () => {
    const perf = fakePerf();
    clearStatsEntries({ isRunningCPUProfiling: false } as never, perf);
    expect(perf.clearMeasures).toHaveBeenCalledWith("cpu-duration");
    expect(perf.clearMarks).toHaveBeenCalledWith("cpu-finished");
    expect(perf.clearMarks).toHaveBeenCalledWith("cpu-started");
  });

  it("keeps cpu-started while profiling", () => {
    const perf = fakePerf();
    clearStatsEntries({ isRunningCPUProfiling: true } as never, perf);
    expect(perf.clearMeasures).toHaveBeenCalledWith("cpu-duration");
    expect(perf.clearMarks).toHaveBeenCalledWith("cpu-finished");
    expect(perf.clearMarks).not.toHaveBeenCalledWith("cpu-started");
  });
});

describe("createInfoSampler", () => {
  const gl = {
    info: { render: { calls: 3, triangles: 12 }, memory: { geometries: 2, textures: 1 } },
  };

  it("writes at most 4 times per second", () => {
    let now = 1000;
    const sample = createInfoSampler(
      gl,
      () => now,
      () => 5,
    );
    sample();
    now += 100;
    sample();
    now += 100;
    sample();
    expect(usePerfStore.getState().info).toEqual({
      calls: 3,
      triangles: 12,
      geometries: 2,
      textures: 1,
      heapMB: 5,
    });
    usePerfStore.setState({ info: null });
    now += 100;
    sample();
    expect(usePerfStore.getState().info?.calls).toBe(3);
  });

  it("does not write before 250 ms have passed", () => {
    let now = 1000;
    const sample = createInfoSampler(
      gl,
      () => now,
      () => null,
    );
    sample();
    usePerfStore.setState({ info: null });
    now += 249;
    sample();
    expect(usePerfStore.getState().info).toBeNull();
  });
});
