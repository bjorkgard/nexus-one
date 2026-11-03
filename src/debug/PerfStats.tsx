import { addAfterEffect, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  acquirePerfStats,
  clearStatsEntries,
  createInfoSampler,
  guardFrame,
  isProbeEnabled,
  usePerfStore,
} from "./perf";

// A known 12-triangle draw so the counters have something to show; dev-only, ?probe=box.
function ProbeBox() {
  return (
    <mesh name="nexus-probe">
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  );
}

export default function PerfStats() {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const { stats, release } = acquirePerfStats(gl);
    usePerfStore.setState({ stats });
    const removeAfterEffect = addAfterEffect(
      guardFrame(() => {
        stats.update();
        clearStatsEntries(stats);
      }, "PerfStats after-effect"),
    );
    return () => {
      removeAfterEffect();
      usePerfStore.setState({ stats: null });
      release();
    };
  }, [gl]);

  const sample = useMemo(() => guardFrame(createInfoSampler(gl), "PerfStats frame"), [gl]);
  // frameloop="demand": the scene idles, so the stats would read nothing. While the overlay is open it keeps
  // the loop running (a frame per display refresh, like the old always-on loop); closed, the scene idles again.
  const visible = usePerfStore((s) => s.visible);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    sample();
    if (visible) invalidate();
  });
  useEffect(() => {
    if (visible) invalidate();
  }, [visible, invalidate]);

  return isProbeEnabled(location.search) ? <ProbeBox /> : null;
}
