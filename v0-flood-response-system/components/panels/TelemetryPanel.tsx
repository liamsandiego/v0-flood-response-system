// =============================================================================
// RapidRelay – Telemetry Panel (Left Side)
//
// Displays real-time sensor readings sorted by severity. Glassmorphism card
// with monospace telemetry readouts. Collapses in critical mode.
// =============================================================================

"use client";

import { useFloodStore } from "@/stores/sensorStore";
import type { SensorProperties, AlertLevel } from "@/stores/sensorStore";
import GlassCard from "./GlassCard";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALERT_CONFIG: Record<AlertLevel, { label: string; dot: string; bg: string }> = {
  CLEAR: { label: "CLEAR", dot: "bg-emerald-400", bg: "text-emerald-400" },
  WATCH: { label: "WATCH", dot: "bg-amber-400", bg: "text-amber-400" },
  WARNING: { label: "WARNING", dot: "bg-orange-400", bg: "text-orange-400" },
  DANGER: { label: "DANGER", dot: "bg-red-400", bg: "text-red-400" },
};

function classifyAlert(wl: number): AlertLevel {
  if (wl >= 2.5) return "DANGER";
  if (wl >= 1.5) return "WARNING";
  if (wl >= 0.8) return "WATCH";
  return "CLEAR";
}

const ALERT_ORDER: Record<AlertLevel, number> = { DANGER: 0, WARNING: 1, WATCH: 2, CLEAR: 3 };

function trendArrow(history: { water_level: number }[]): string {
  if (history.length < 2) return "";
  const prev = history[history.length - 2].water_level;
  const curr = history[history.length - 1].water_level;
  const diff = curr - prev;
  if (diff > 0.05) return "▲";
  if (diff < -0.05) return "▼";
  return "—";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TelemetryPanel() {
  const sensorData = useFloodStore((s) => s.sensorData);
  const sensorHistory = useFloodStore((s) => s.sensorHistory);
  const criticalMode = useFloodStore((s) => s.criticalMode);
  const wsStatus = useFloodStore((s) => s.wsStatus);
  const tick = useFloodStore((s) => s.tick);

  // Sort sensors by alert severity
  const sensors = [...sensorData.features]
    .map((f) => ({
      ...f.properties,
      alert: classifyAlert(f.properties.water_level ?? 0),
    }))
    .sort((a, b) => ALERT_ORDER[a.alert] - ALERT_ORDER[b.alert]);

  return (
    <GlassCard
      className="w-72 max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden"
      critical={criticalMode}
    >
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🛰</span>
          <h1 className="font-mono text-sm font-bold text-white tracking-wider">
            RAPID RELAY
          </h1>
        </div>
        <p className="font-mono text-[10px] text-white/40 tracking-widest uppercase">
          Obando, Bulacan — Flood Monitoring
        </p>

        {/* Connection status */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                wsStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : wsStatus === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-400"
              }`}
            />
            <span className="font-mono text-[10px] text-white/60 uppercase">
              {wsStatus}
            </span>
          </div>
          <span className="font-mono text-[10px] text-white/30">
            T+{tick}
          </span>
        </div>
      </div>

      {/* Sensor List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
        <AnimatePresence mode="popLayout">
          {sensors.length === 0 ? (
            <div className="p-4 text-center">
              <p className="font-mono text-xs text-white/30">
                Waiting for sensor data...
              </p>
            </div>
          ) : (
            sensors.map((sensor) => {
              const cfg = ALERT_CONFIG[sensor.alert];
              const history = sensorHistory.get(sensor.sensor_id) || [];
              const trend = trendArrow(history);

              return (
                <motion.div
                  key={sensor.sensor_id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className={`p-3 border-b border-white/5 ${
                    sensor.alert === "DANGER" ? "bg-red-500/10" : ""
                  }`}
                >
                  {/* Sensor name + alert badge */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[11px] text-white/80 truncate max-w-[140px]">
                      {sensor.name}
                    </span>
                    <span
                      className={`flex items-center gap-1 font-mono text-[9px] font-bold ${cfg.bg}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </div>

                  {/* Telemetry readouts */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <TelemetryRow
                      label="WATER"
                      value={
                        sensor.water_level != null
                          ? `${sensor.water_level.toFixed(2)}m`
                          : "N/A"
                      }
                      trend={trend}
                      critical={sensor.alert === "DANGER" || sensor.alert === "WARNING"}
                    />
                    <TelemetryRow
                      label="RAIN"
                      value={
                        sensor.rainfall != null
                          ? `${sensor.rainfall.toFixed(1)}mm`
                          : "N/A"
                      }
                    />
                    <TelemetryRow
                      label="HUMID"
                      value={
                        sensor.humidity != null
                          ? `${sensor.humidity.toFixed(0)}%`
                          : "N/A"
                      }
                    />
                    <TelemetryRow
                      label="TEMP"
                      value={
                        sensor.temperature != null
                          ? `${sensor.temperature.toFixed(1)}°C`
                          : "N/A"
                      }
                    />
                  </div>

                  {/* Valid indicator */}
                  {!sensor.is_valid && (
                    <div className="mt-1 font-mono text-[9px] text-red-400/80">
                      ⚠ SENSOR FAULT
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Telemetry Row
// ---------------------------------------------------------------------------

function TelemetryRow({
  label,
  value,
  trend,
  critical,
}: {
  label: string;
  value: string;
  trend?: string;
  critical?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-mono text-[8px] text-white/30 w-10">{label}</span>
      <span
        className={`font-mono text-[11px] ${
          critical ? "text-orange-300 font-bold" : "text-white/70"
        }`}
      >
        {value}
      </span>
      {trend && (
        <span
          className={`text-[10px] ${
            trend === "▲" ? "text-red-400" : trend === "▼" ? "text-emerald-400" : "text-white/20"
          }`}
        >
          {trend}
        </span>
      )}
    </div>
  );
}
