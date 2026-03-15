// =============================================================================
// RapidRelay – Mission Control Dashboard
//
// Full-screen 3D globe with floating glassmorphism panels. Connects to
// backend WebSocket for real-time sensor data and ML predictions.
// This replaces the old 2D Leaflet dashboard entirely.
// =============================================================================

"use client";

import dynamic from "next/dynamic";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useFloodStore } from "@/stores/sensorStore";
import TelemetryPanel from "@/components/panels/TelemetryPanel";
import PredictionPanel from "@/components/panels/PredictionPanel";
import AlertBanner from "@/components/panels/AlertBanner";
import StatusBar from "@/components/panels/StatusBar";
import { useCallback } from "react";

// Dynamic import for GlobeMap (avoid SSR — mapbox-gl requires window)
const GlobeMap = dynamic(() => import("@/components/globe/GlobeMap"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin mx-auto" />
        <p className="font-mono text-xs text-white/40 tracking-widest uppercase">
          Initializing Globe
        </p>
      </div>
    </div>
  ),
});

export default function MissionControl() {
  const { send } = useWebSocket();
  const criticalMode = useFloodStore((s) => s.criticalMode);

  const triggerFlood = useCallback(() => {
    send({ type: "trigger_flood", intensity: 0.85, duration: 150 });
  }, [send]);

  const stopFlood = useCallback(() => {
    send({ type: "stop_flood" });
  }, [send]);

  return (
    <div
      className={`
        relative h-screen w-screen overflow-hidden bg-slate-950
        transition-all duration-1000
        ${criticalMode ? "shadow-[inset_0_0_200px_rgba(220,38,38,0.15)]" : ""}
      `}
    >
      {/* ============================================================= */}
      {/* LAYER 0: 3D Globe (full screen background)                    */}
      {/* ============================================================= */}
      <div className="absolute inset-0 z-0">
        <GlobeMap />
      </div>

      {/* ============================================================= */}
      {/* LAYER 1: Alert Banner (top, conditional)                      */}
      {/* ============================================================= */}
      <AlertBanner />

      {/* ============================================================= */}
      {/* LAYER 2: Floating UI Panels                                   */}
      {/* ============================================================= */}

      {/* Left — Telemetry */}
      <div className="absolute top-4 left-4 z-10">
        <TelemetryPanel />
      </div>

      {/* Right — Predictions */}
      <div className="absolute top-4 right-4 z-10">
        <PredictionPanel />
      </div>

      {/* Bottom Center — Status Bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <StatusBar onTriggerFlood={triggerFlood} onStopFlood={stopFlood} />
      </div>

      {/* ============================================================= */}
      {/* LAYER 3: Critical mode overlay (red vignette)                 */}
      {/* ============================================================= */}
      {criticalMode && (
        <div
          className="absolute inset-0 z-[5] pointer-events-none animate-pulse"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(220, 38, 38, 0.08) 100%)",
            animationDuration: "3s",
          }}
        />
      )}
    </div>
  );
}
