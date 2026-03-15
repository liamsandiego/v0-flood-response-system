// =============================================================================
// RapidRelay – Status Bar (Bottom Center)
//
// Compact bar showing connection status, tick counter, alert level, and
// a simulation control button (trigger/stop flood).
// =============================================================================

"use client";

import { useFloodStore } from "@/stores/sensorStore";
import type { AlertLevel } from "@/stores/sensorStore";
import { useCallback } from "react";

const ALERT_DOT: Record<AlertLevel, string> = {
  CLEAR: "bg-emerald-400",
  WATCH: "bg-amber-400",
  WARNING: "bg-orange-400",
  DANGER: "bg-red-400",
};

interface StatusBarProps {
  onTriggerFlood: () => void;
  onStopFlood: () => void;
}

export default function StatusBar({ onTriggerFlood, onStopFlood }: StatusBarProps) {
  const wsStatus = useFloodStore((s) => s.wsStatus);
  const alertLevel = useFloodStore((s) => s.alertLevel);
  const tick = useFloodStore((s) => s.tick);
  const clientCount = useFloodStore((s) => s.clientCount);
  const lastUpdate = useFloodStore((s) => s.lastUpdate);
  const sensorData = useFloodStore((s) => s.sensorData);

  const floodActive = sensorData.features.some((f) => f.properties.flood_mode);

  const timestamp = lastUpdate
    ? lastUpdate.toLocaleTimeString("en-US", { hour12: false })
    : "--:--:--";

  return (
    <div className="backdrop-blur-xl bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-4">
      {/* Connection */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2 h-2 rounded-full ${
            wsStatus === "connected" ? "bg-emerald-400 animate-pulse" : "bg-red-400"
          }`}
        />
        <span className="font-mono text-[10px] text-white/50 uppercase">
          {wsStatus === "connected" ? "LIVE" : wsStatus}
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-white/10" />

      {/* Alert Level */}
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${ALERT_DOT[alertLevel]}`} />
        <span className="font-mono text-[10px] text-white/50">{alertLevel}</span>
      </div>

      <div className="w-px h-4 bg-white/10" />

      {/* Tick / Time */}
      <span className="font-mono text-[10px] text-white/30">
        T+{tick} | {timestamp}
      </span>

      <div className="w-px h-4 bg-white/10" />

      {/* Sensors + Clients */}
      <span className="font-mono text-[10px] text-white/30">
        {sensorData.features.length} sensors | {clientCount} clients
      </span>

      <div className="w-px h-4 bg-white/10" />

      {/* Simulation controls */}
      {!floodActive ? (
        <button
          onClick={onTriggerFlood}
          className="font-mono text-[9px] px-2 py-1 rounded border border-red-500/30
            text-red-400/70 hover:text-red-300 hover:bg-red-500/10 transition-colors uppercase tracking-wider"
        >
          Sim Flood
        </button>
      ) : (
        <button
          onClick={onStopFlood}
          className="font-mono text-[9px] px-2 py-1 rounded border border-emerald-500/30
            text-emerald-400/70 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors uppercase tracking-wider"
        >
          Stop Flood
        </button>
      )}
    </div>
  );
}
