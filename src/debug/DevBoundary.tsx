import { Component } from "react";
import type { ReactNode } from "react";

interface DevBoundaryProps {
  name: string;
  children?: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
}

interface DevBoundaryState {
  error: Error | null;
}

// A failed dev part logs and renders its fallback (default nothing), so it never reaches CanvasErrorBoundary or blanks the App.
export class DevBoundary extends Component<DevBoundaryProps, DevBoundaryState> {
  state: DevBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DevBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`DevBoundary ${this.props.name}`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback = null } = this.props;
    return typeof fallback === "function" ? fallback(error) : fallback;
  }
}
