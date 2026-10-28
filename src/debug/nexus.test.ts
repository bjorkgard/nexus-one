import { OrthographicCamera, PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createNexusRegistry,
  installNexus,
  projectToPage,
  readRendererInfo,
  registerNexusModule,
  type CameraInfo,
  type NexusApi,
} from "./nexus";

const cameraInfo: CameraInfo = {
  type: "PerspectiveCamera",
  position: [0, 0, 5],
  projectionMatrix: [],
};
const getCamera = () => cameraInfo;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("createNexusRegistry", () => {
  it("exposes a registered hook on api", () => {
    const { api, register } = createNexusRegistry();
    register("getCamera", getCamera);
    expect(api.getCamera?.()).toBe(cameraInfo);
  });

  it("throws the exact message when a live name is registered again", () => {
    const { register } = createNexusRegistry();
    register("getCamera", getCamera);
    expect(() => register("getCamera", getCamera)).toThrow(
      new Error("__nexus.getCamera is already registered"),
    );
  });

  it("removes the member when the returned function is called", () => {
    const { api, register } = createNexusRegistry();
    register("getCamera", getCamera)();
    expect("getCamera" in api).toBe(false);
  });

  it("allows registering again after unregister", () => {
    const { api, register } = createNexusRegistry();
    register("getCamera", getCamera)();
    register("getCamera", getCamera);
    expect(api.getCamera).toBe(getCamera);
  });

  it("is safe to unregister twice", () => {
    const { api, register } = createNexusRegistry();
    const un = register("getCamera", getCamera);
    un();
    expect(() => un()).not.toThrow();
    expect("getCamera" in api).toBe(false);
  });

  it("keeps a later registration when a stale unregister is called again", () => {
    const { api, register } = createNexusRegistry();
    const getCameraB = () => cameraInfo;
    const unA = register("getCamera", getCamera);
    unA();
    register("getCamera", getCameraB);
    unA();
    expect(api.getCamera).toBe(getCameraB);
  });
});

describe("installNexus", () => {
  it("gives the same object on the target across two calls", () => {
    const target: { __nexus?: NexusApi } = {};
    installNexus(target);
    const first = target.__nexus;
    installNexus(target);
    expect(first).toBeDefined();
    expect(target.__nexus).toBe(first);
  });

  it("replaces target.__nexus with the api of a freshly imported module", async () => {
    const target: { __nexus?: NexusApi } = {};
    installNexus(target);
    const first = target.__nexus;
    vi.resetModules();
    const fresh = await import("./nexus");
    fresh.installNexus(target);
    expect(target.__nexus).toBeDefined();
    expect(target.__nexus).not.toBe(first);
  });
});

describe("registerNexusModule", () => {
  const rendererInfo = () => ({ calls: 0, triangles: 0, geometries: 0, textures: 0 });

  it("unregisters when the hot dispose callback runs, then allows re-registering", () => {
    let dispose: (() => void) | undefined;
    const hot = {
      dispose(cb: () => void) {
        dispose = cb;
      },
    };
    const target: { __nexus?: NexusApi } = {};
    installNexus(target);
    registerNexusModule(hot, "rendererInfo", rendererInfo);
    expect(target.__nexus?.rendererInfo).toBe(rendererInfo);
    dispose?.();
    expect(target.__nexus?.rendererInfo).toBeUndefined();
    const un = registerNexusModule(undefined, "rendererInfo", rendererInfo);
    expect(target.__nexus?.rendererInfo).toBe(rendererInfo);
    un();
  });
});

describe("outside DEV", () => {
  it("registerNexus returns a function and adds no member to api", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();
    const fresh = await import("./nexus");
    const target: { __nexus?: NexusApi } = {};
    fresh.installNexus(target);
    const un = fresh.registerNexus("getCamera", getCamera);
    expect(un).toBeTypeOf("function");
    expect("getCamera" in (target.__nexus ?? {})).toBe(false);
  });
});

describe("registerNexusModule outside DEV", () => {
  it("returns a function, registers nothing and never touches hot", async () => {
    // Value: protects=prod registerNexusModule is a no-op with no hot.dispose use; fails_when=the DEV gate is dropped from it; why_new=outside-DEV test covers registerNexus only; seam=none; no_claim=bundle contents (module-level env stub; build guard owns that)
    vi.stubEnv("DEV", false);
    vi.resetModules();
    const fresh = await import("./nexus");
    const target: { __nexus?: NexusApi } = {};
    fresh.installNexus(target);
    const dispose = vi.fn();
    const un = fresh.registerNexusModule({ dispose }, "getCamera", getCamera);
    expect(un).toBeTypeOf("function");
    expect("getCamera" in (target.__nexus ?? {})).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("projectToPage", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  const perspective = new PerspectiveCamera(50, 2, 0.1, 100);
  perspective.position.set(0, 0, 5);
  perspective.lookAt(0, 0, 0);
  perspective.updateMatrixWorld();
  perspective.updateProjectionMatrix();

  it("maps the origin to the rect center and marks it visible", () => {
    const p = projectToPage(perspective, rect, [0, 0, 0]);
    expect(p.x).toBeCloseTo(110);
    expect(p.y).toBeCloseTo(70);
    expect(p.visible).toBe(true);
  });

  it.each([
    ["behind the camera", [0, 0, 10]],
    ["beyond the far plane", [0, 0, -200]],
    ["off canvas", [100, 0, 0]],
  ] as const)("marks a point %s as not visible", (_name, pos) => {
    expect(projectToPage(perspective, rect, pos).visible).toBe(false);
  });

  it.each([
    ["NaN", [Number.NaN, 0, 0]],
    ["Infinity", [0, Number.POSITIVE_INFINITY, 0]],
  ] as const)("throws TypeError naming a %s coordinate", (name, pos) => {
    expect(() => projectToPage(perspective, rect, pos)).toThrow(TypeError);
    expect(() => projectToPage(perspective, rect, pos)).toThrow(name);
  });

  it("respects orthographic zoom for the visibility bounds", () => {
    const ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    ortho.position.set(0, 0, 5);
    ortho.zoom = 2;
    ortho.updateMatrixWorld();
    ortho.updateProjectionMatrix();
    expect(projectToPage(ortho, rect, [0.4, 0, 0]).visible).toBe(true);
    expect(projectToPage(ortho, rect, [0.6, 0, 0]).visible).toBe(false);
  });

  it("puts +x right of and +y above the rect center (y axis flipped to page space)", () => {
    // Value: protects=page-space axis orientation (x right, y down); fails_when=the (1 - ndc.y) flip or x sign is inverted; why_new=existing cases only project the symmetric origin; seam=none; no_claim=real renderer canvas rect (hand-built camera and rect)
    const right = projectToPage(perspective, rect, [1, 0, 0]);
    const up = projectToPage(perspective, rect, [0, 1, 0]);
    expect(right.x).toBeGreaterThan(110);
    expect(right.y).toBeCloseTo(70);
    expect(up.y).toBeLessThan(70);
    expect(up.x).toBeCloseTo(110);
  });
});

describe("readRendererInfo", () => {
  it("reads the four counters from gl.info", () => {
    const gl = {
      info: { render: { calls: 3, triangles: 12 }, memory: { geometries: 2, textures: 1 } },
    };
    expect(readRendererInfo(gl)).toEqual({ calls: 3, triangles: 12, geometries: 2, textures: 1 });
  });
});
