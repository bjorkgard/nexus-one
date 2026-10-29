import { Vector3 } from "three";
import type { Camera } from "three";
import type { DataStats } from "../data/source";
import type { Vec3 } from "../world/zones";

export type { Vec3 };

export type CameraInfo = {
  type: string;
  position: [number, number, number];
  direction: [number, number, number];
  target: [number, number, number] | null;
  zoom: number;
  projectionMatrix: number[];
};

export type ProjectedPoint = { x: number; y: number; visible: boolean };

export type RendererInfo = {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
};

export type RendererInfoSource = {
  info: {
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
  };
};

export type DataState = DataStats & { source: "mock" | "live"; clock: number | null };

export interface NexusHooks {
  getCamera(): CameraInfo;
  project(worldPos: Vec3): ProjectedPoint;
  rendererInfo(): RendererInfo;
  emit(event: unknown): void;
  setClock(ts: number): void;
  dataState(): DataState;
}

export type NexusApi = Partial<NexusHooks>;

declare global {
  interface Window {
    __nexus?: NexusApi;
  }
}

export function createNexusRegistry() {
  const api: NexusApi = {};
  function register<K extends keyof NexusHooks>(name: K, fn: NexusHooks[K]): () => void {
    if (name in api) {
      throw new Error(`__nexus.${name} is already registered`);
    }
    api[name] = fn;
    return () => {
      if (api[name] === fn) delete api[name];
    };
  }
  return { api, register };
}

const registry = /* @__PURE__ */ createNexusRegistry();

export const registerNexus: <K extends keyof NexusHooks>(name: K, fn: NexusHooks[K]) => () => void =
  import.meta.env.DEV ? (name, fn) => registry.register(name, fn) : () => () => {};

export const registerNexusModule: <K extends keyof NexusHooks>(
  hot: { dispose(cb: () => void): void } | undefined,
  name: K,
  fn: NexusHooks[K],
) => () => void = import.meta.env.DEV
  ? (hot, name, fn) => {
      const un = registerNexus(name, fn);
      hot?.dispose(un);
      return un;
    }
  : () => () => {};

export function installNexus(target: { __nexus?: NexusApi }): void {
  target.__nexus = registry.api;
}

export function readRendererInfo(gl: RendererInfoSource): RendererInfo {
  return {
    calls: gl.info.render.calls,
    triangles: gl.info.render.triangles,
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
  };
}

export function projectToPage(
  camera: Camera,
  rect: { left: number; top: number; width: number; height: number },
  worldPos: Vec3,
): ProjectedPoint {
  for (const value of worldPos) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`projectToPage: non-finite coordinate ${value}`);
    }
  }
  const ndc = new Vector3(...worldPos).project(camera);
  const visible = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1;
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    visible,
  };
}
