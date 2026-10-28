import { Component } from "react";
import type { ReactNode } from "react";

interface DevBoundaryProps {
  name: string;
  children?: ReactNode;
}

interface DevBoundaryState {
  error: Error | null;
}

// A failed dev part logs and renders nothing, so it never reaches CanvasErrorBoundary or blanks the App.
export class DevBoundary extends Component<DevBoundaryProps, DevBoundaryState> {
  state: DevBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DevBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`DevBoundary ${this.props.name}`, error);
  }

  render() {
    return this.state.error ? null : this.props.children;
  }
}
