import { useEffect, useRef } from "react";
import { drawCallLevel } from "./perf-budget";
import type { DrawCallLevel } from "./perf-budget";
import { isToggleKey, usePerfStore } from "./perf";

const LEVEL_CLASS: Record<DrawCallLevel, string> = {
  ok: "text-white",
  warn: "text-yellow-400",
  over: "text-red-400",
};

function format(value: number | null | undefined, digits = 0): string {
  return value == null ? "—" : value.toFixed(digits);
}

export default function PerfPanel() {
  const visible = usePerfStore((s) => s.visible);
  const stats = usePerfStore((s) => s.stats);
  const info = usePerfStore((s) => s.info);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isToggleKey(e)) usePerfStore.getState().toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!stats || !host.current) return;
    const el = stats.domElement;
    // stats-gl positions its root fixed at the top left; the wrapper owns placement.
    Object.assign(el.style, { position: "relative", top: "auto", left: "auto", zIndex: "auto" });
    host.current.appendChild(el);
    return () => el.remove();
  }, [stats]);

  return (
    <div
      id="nexus-perf-overlay"
      data-testid="perf-overlay"
      hidden={!visible}
      className="pointer-events-none absolute top-4 right-4 font-mono text-xs text-white"
    >
      {/* stats-gl sets position: absolute on each canvas, again on window resize; an important class beats inline style. */}
      <div
        ref={host}
        data-testid="perf-host"
        className="[&_canvas]:static! [&_canvas]:inline-block!"
      />
      <div className="mt-1 rounded bg-black/70 p-1">
        <div className={info ? LEVEL_CLASS[drawCallLevel(info.calls)] : LEVEL_CLASS.ok}>
          draw calls <span data-testid="perf-calls">{format(info?.calls)}</span>
        </div>
        <div>
          triangles <span data-testid="perf-triangles">{format(info?.triangles)}</span>
        </div>
        <div>geometries {format(info?.geometries)}</div>
        <div>textures {format(info?.textures)}</div>
        <div>heap {info?.heapMB == null ? "—" : `${format(info.heapMB, 1)} MB`}</div>
      </div>
    </div>
  );
}
