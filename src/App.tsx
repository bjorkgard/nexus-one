import { Canvas } from "@react-three/fiber";
import { Component, Suspense, lazy, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AgXToneMapping, SRGBColorSpace } from "three";

import { DevBoundary } from "./debug/DevBoundary";
import { ErrorPanel } from "./ui/ErrorPanel";
import { Wordmark } from "./ui/Wordmark";
import { Stage } from "./world/Stage";
import { LOOK } from "./world/stage-look";

const NexusBridge = import.meta.env.DEV ? lazy(() => import("./debug/Bridge")) : null;
const PerfStats = import.meta.env.DEV ? lazy(() => import("./debug/PerfStats")) : null;
const PerfPanel = import.meta.env.DEV ? lazy(() => import("./debug/PerfPanel")) : null;
const ZoneOverlay = import.meta.env.DEV ? lazy(() => import("./debug/ZoneOverlay")) : null;

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
          fallback={
            <div className="p-4 text-neutral-300">This browser does not support canvas.</div>
          }
        >
          <Stage onReady={() => setRevealed(true)}>
            {ZoneOverlay && (
              <DevBoundary name="ZoneOverlay">
                <Suspense fallback={null}>
                  <ZoneOverlay />
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
