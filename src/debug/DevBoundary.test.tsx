import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DevBoundary } from "./DevBoundary";

afterEach(() => {
  vi.restoreAllMocks();
});

// The vitest environment is Node, so these call the boundary's methods directly instead of rendering.
describe("DevBoundary", () => {
  it("getDerivedStateFromError stores the error", () => {
    const error = new Error("boom");
    expect(DevBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it("render returns the children without an error", () => {
    const boundary = new DevBoundary({ name: "PerfPanel", children: "kids" });
    boundary.state = { error: null };
    expect(boundary.render()).toBe("kids");
  });

  it("render returns null with an error", () => {
    const boundary = new DevBoundary({ name: "PerfPanel", children: "kids" });
    boundary.state = { error: new Error("boom") };
    expect(boundary.render()).toBeNull();
  });

  it("render returns the fallback node with an error", () => {
    const boundary = new DevBoundary({ name: "PaletteBoard", children: "kids", fallback: "oops" });
    boundary.state = { error: new Error("boom") };
    expect(boundary.render()).toBe("oops");
  });

  it("render calls a fallback function with the error", () => {
    const error = new Error("boom");
    const boundary = new DevBoundary({
      name: "PaletteBoard",
      children: "kids",
      fallback: (e) => `failed: ${e.message}`,
    });
    boundary.state = { error };
    expect(boundary.render()).toBe("failed: boom");
  });

  it("componentDidCatch logs once with the part name", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new DevBoundary({ name: "PerfPanel", children: null });
    const error = new Error("boom");
    boundary.componentDidCatch(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("PerfPanel");
    expect(spy.mock.calls[0]).toContain(error);
  });
});
