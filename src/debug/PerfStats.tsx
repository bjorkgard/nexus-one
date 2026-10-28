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
  useFrame(sample);

  return isProbeEnabled(location.search) ? <ProbeBox /> : null;
}
