"use client";

import React from "react";

interface MapErrorBoundaryState { hasError: boolean }

export class MapErrorBoundary extends React.Component<
  { children: React.ReactNode },
  MapErrorBoundaryState
> {
  state: MapErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[MapErrorBoundary] Rendering crashed:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
          <div className="text-center space-y-4 p-8">
            <div className="text-4xl">&#x26A0;</div>
            <h2 className="text-lg font-mono text-white/80">Map rendering failed</h2>
            <p className="text-sm text-white/50 max-w-md font-mono">
              Your device may not support 3D map rendering. Try reloading.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
