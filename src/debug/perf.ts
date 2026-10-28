import Stats from "stats-gl";
import { create } from "zustand";
import { readRendererInfo } from "./nexus";
import type { RendererInfo, RendererInfoSource } from "./nexus";

export type PerfInfo = RendererInfo & { heapMB: number | null };

type PerfState = {
  visible: boolean;
  toggle: () => void;
  stats: Stats | null;
  info: PerfInfo | null;
};

// The store carries the stats DOM from the Canvas tree to the DOM tree; no refs cross.
export const usePerfStore = create<PerfState>()((set) => ({
  visible: false,
  toggle: () => set((state) => ({ visible: !state.visible })),
  stats: null,
  info: null,
}));

type KeyLike = {
  code: string;
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  target: unknown;
};

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isToggleKey(e: KeyLike): boolean {
  // Swedish (and similar) layouts type backtick as Shift + the dead ´ key: key "Dead", code "Equal".
  const deadBacktick = e.key === "Dead" && e.code === "Equal" && e.shiftKey === true;
  if (e.code !== "Backquote" && e.key !== "`" && !deadBacktick) return false;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
  const target = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (target?.tagName && TYPING_TAGS.has(target.tagName)) return false;
  if (target?.isContentEditable) return false;
  return true;
}

export function isProbeEnabled(search: string): boolean {
  return new URLSearchParams(search).get("probe") === "box";
}

// On the first throw, log once and become a no-op so the scene keeps rendering.
export function guardFrame<A extends unknown[]>(
  fn: (...args: A) => void,
  name: string,
): (...args: A) => void {
  let failed = false;
  return (...args) => {
    if (failed) return;
    try {
      fn(...args);
    } catch (err) {
      failed = true;
      console.error(name, err);
    }
  };
}

// stats.init(gl) wraps gl.render with stats.begin()/end(); restore() below puts the original back.
// Per frame: that wrapper runs around gl.render, then the after-effect runs stats.update() and
// clearStatsEntries(). update() reads the marks, so the clear must come after it.
const PERF_KEY = Symbol.for("nexus.perfStats");

type Entry = { stats: Stats; count: number; restore: () => void };
type Holder = { [PERF_KEY]?: Entry };

// Ref-counted per renderer: StrictMode and HMR remounts share one instance; the last release undoes it.
export function acquirePerfStats(gl: { render: (...args: never[]) => void }): {
  stats: Stats;
  release: () => void;
} {
  const holder = gl as unknown as Holder;
  let entry = holder[PERF_KEY];
  if (!entry) {
    const originalRender = gl.render;
    const stats = new Stats({ trackGPU: true });
    // Checked against stats-gl 2.4.2 (pinned in package.json): handleResize is private in its types.
    const onResize = (stats as unknown as { handleResize: () => void }).handleResize;
    stats.init(gl).catch((err: unknown) => console.error("PerfStats init", err));
    entry = {
      stats,
      count: 0,
      restore: () => {
        gl.render = originalRender;
        window.removeEventListener("resize", onResize);
        delete holder[PERF_KEY];
      },
    };
    holder[PERF_KEY] = entry;
  }
  entry.count++;
  const acquired = entry;
  let released = false;
  return {
    stats: acquired.stats,
    release() {
      if (released) return;
      released = true;
      if (--acquired.count === 0) acquired.restore();
    },
  };
}

// stats-gl adds a mark pair and a measure per frame and never clears them. Checked against
// stats-gl 2.4.2: isRunningCPUProfiling is private; cpu-started must survive while a profile is open.
// On 0 ms frames stats-gl re-marks cpu-started in resetCounters (dist/main.js:186-190), so up to 2 can exist.
export function clearStatsEntries(
  stats: Stats,
  perf: Pick<Performance, "clearMeasures" | "clearMarks"> = performance,
): void {
  perf.clearMeasures("cpu-duration");
  perf.clearMarks("cpu-finished");
  if (!(stats as unknown as { isRunningCPUProfiling: boolean }).isRunningCPUProfiling) {
    perf.clearMarks("cpu-started");
  }
}

function readHeapMB(): number | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / (1024 * 1024) : null;
}

const SAMPLE_INTERVAL_MS = 250;

// Writes the counters to the store at most 4 times per second.
export function createInfoSampler(
  gl: RendererInfoSource,
  now: () => number = () => performance.now(),
  heap: () => number | null = readHeapMB,
): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < SAMPLE_INTERVAL_MS) return;
    last = t;
    usePerfStore.setState({ info: { ...readRendererInfo(gl), heapMB: heap() } });
  };
}
