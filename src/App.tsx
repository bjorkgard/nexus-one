import { Canvas } from "@react-three/fiber";
import { Component, Suspense, lazy } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { DevBoundary } from "./debug/DevBoundary";

const NexusBridge = import.meta.env.DEV ? lazy(() => import("./debug/Bridge")) : null;
const PerfStats = import.meta.env.DEV ? lazy(() => import("./debug/PerfStats")) : null;
const PerfPanel = import.meta.env.DEV ? lazy(() => import("./debug/PerfPanel")) : null;

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
    if (this.state.error) {
      const { message } = this.state.error;
      const title = /webgl/i.test(message) ? "WebGL is unavailable" : "The 3D view failed to load";
      return (
        <div
          role="alert"
          className="flex h-full items-center justify-center p-4 text-center text-red-400"
        >
          {title}: {message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <div className="relative h-full w-full">
      <CanvasErrorBoundary>
        <Canvas
          data-testid="scene"
          fallback={
            <div className="p-4 text-neutral-300">This browser does not support canvas.</div>
          }
        >
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
      <div className="pointer-events-none absolute top-4 left-4 text-lg font-semibold text-white">
        Nexus One
      </div>
    </div>
  );
}
