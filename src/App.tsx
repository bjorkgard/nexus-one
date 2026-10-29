import { Canvas } from "@react-three/fiber";
import { Component, Suspense, lazy, useState, useSyncExternalStore } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AgXToneMapping, SRGBColorSpace } from "three";

import { DevBoundary } from "./debug/DevBoundary";
import { PaletteFailure } from "./debug/PaletteFailure";
import { ErrorPanel } from "./ui/ErrorPanel";
import { Wordmark } from "./ui/Wordmark";
import { useRevealHold } from "./world/reveal-hold";
import { Stage } from "./world/Stage";
import { LOOK } from "./world/stage-look";

const NexusBridge = import.meta.env.DEV ? lazy(() => import("./debug/Bridge")) : null;
const PerfStats = import.meta.env.DEV ? lazy(() => import("./debug/PerfStats")) : null;
const PerfPanel = import.meta.env.DEV ? lazy(() => import("./debug/PerfPanel")) : null;
const ZoneOverlay = import.meta.env.DEV ? lazy(() => import("./debug/ZoneOverlay")) : null;
const PaletteBoard = import.meta.env.DEV ? lazy(() => import("./debug/PaletteBoard")) : null;
// Suspense fallback while the board module loads: silent until the hold times out, then the one failure line.
// When the module arrives late the fallback unmounts and the board shows its own line.
function PaletteBoardPending() {
  const hold = useRevealHold();
  const status = useSyncExternalStore(hold.subscribe, () => hold.status);
  return status === "timedOut" ? <PaletteFailure message="Palette board timed out" /> : null;
}
const paletteBoardOn = () =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("palette") === "1";

interface CanvasErrorBoundaryProps {
  children: ReactNode;
}

interface CanvasErrorBoundaryState {
  error: Error | null;
}

export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) return <ErrorPanel error={this.state.error} />;
    return this.props.children;
  }
}

export function App() {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative h-full w-full">
      <CanvasErrorBoundary>
        <Canvas
          data-testid="scene"
          className="nx-stage"
          role="img"
          aria-label="Nexus One campus, isometric view"
          data-revealed={revealed}
          dpr={LOOK.dpr}
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: AgXToneMapping,
            toneMappingExposure: LOOK.exposure,
            outputColorSpace: SRGBColorSpace,
          }}
          fallback={<p className="nx-error-text p-4">This browser does not support canvas.</p>}
        >
          <Stage onReady={() => setRevealed(true)}>
            {ZoneOverlay && (
              <DevBoundary name="ZoneOverlay">
                <Suspense fallback={null}>
                  <ZoneOverlay />
                </Suspense>
              </DevBoundary>
            )}
            {PaletteBoard && paletteBoardOn() && (
              <DevBoundary
                name="PaletteBoard"
                fallback={(error) => (
                  <PaletteFailure message={`Palette board failed: ${error.message}`} />
                )}
              >
                <Suspense fallback={<PaletteBoardPending />}>
                  <PaletteBoard />
                </Suspense>
              </DevBoundary>
            )}
          </Stage>
          {NexusBridge && (
            <DevBoundary name="Bridge">
              <Suspense fallback={null}>
                <NexusBridge />
              </Suspense>
            </DevBoundary>
          )}
          {PerfStats && (
            <DevBoundary name="PerfStats">
              <Suspense fallback={null}>
                <PerfStats />
              </Suspense>
            </DevBoundary>
          )}
        </Canvas>
      </CanvasErrorBoundary>
      {PerfPanel && (
        <DevBoundary name="PerfPanel">
          <Suspense fallback={null}>
            <PerfPanel />
          </Suspense>
        </DevBoundary>
      )}
      <Wordmark />
    </div>
  );
}
