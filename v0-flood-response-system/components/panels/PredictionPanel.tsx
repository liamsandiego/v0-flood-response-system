// =============================================================================
// RapidRelay – Prediction Panel (Right Side)
//
// Shows ML prediction gauge, alert level, time-to-impact countdown,
// and model metadata. Glassmorphism style with monospace readouts.
// =============================================================================

"use client";

import { useMemo } from "react";
import { useFloodStore } from "@/stores/sensorStore";
import type { AlertLevel } from "@/stores/sensorStore";
import GlassCard from "./GlassCard";
import { motion } from "framer-motion";

// ---------------------------------------------------------------------------
// Alert color config
// ---------------------------------------------------------------------------

const ALERT_STYLE: Record<AlertLevel, { color: string; glow: string; ring: string }> = {
  CLEAR: { color: "text-emerald-400", glow: "shadow-emerald-400/20", ring: "stroke-emerald-400" },
  WATCH: { color: "text-amber-400", glow: "shadow-amber-400/20", ring: "stroke-amber-400" },
  WARNING: { color: "text-orange-400", glow: "shadow-orange-400/30", ring: "stroke-orange-400" },
  DANGER: { color: "text-red-400", glow: "shadow-red-400/40", ring: "stroke-red-400" },
};

// ---------------------------------------------------------------------------
// Ring gauge
// ---------------------------------------------------------------------------

function RiskGauge({ probability, alertLevel }: { probability: number; alertLevel: AlertLevel }) {
  const style = ALERT_STYLE[alertLevel];
  const pct = Math.round(probability * 100);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - probability);

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        {/* Track */}
        <circle cx="60" cy="60" r={radius} fill="none" stroke="white" strokeOpacity={0.05} strokeWidth={8} />
        {/* Value arc */}
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          className={style.ring}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-3xl font-bold ${style.color}`}>{pct}%</span>
        <span className={`font-mono text-[10px] font-bold tracking-widest ${style.color}`}>
          {alertLevel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time-to-impact estimation
// ---------------------------------------------------------------------------

function useTimeToImpact() {
  const sensorHistory = useFloodStore((s) => s.sensorHistory);

  return useMemo(() => {
    // Find the sensor with highest water level
    let maxRate = 0;
    let currentLevel = 0;
    const criticalLevel = 2.5; // meters (dike crest at ~3m)

    for (const [, history] of sensorHistory) {
      if (history.length < 4) continue;
      const recent = history.slice(-6);
      const first = recent[0].water_level;
      const last = recent[recent.length - 1].water_level;
      const rate = (last - first) / recent.length; // m per tick (5s each)

      if (last > currentLevel) {
        currentLevel = last;
        maxRate = rate;
      }
    }

    if (maxRate <= 0.001 || currentLevel >= criticalLevel) {
      return { minutes: null, rate: maxRate, level: currentLevel };
    }

    const remaining = criticalLevel - currentLevel;
    const ticksToImpact = remaining / maxRate;
    const minutes = Math.round((ticksToImpact * 5) / 60); // 5s per tick

    return {
      minutes: minutes > 0 && minutes < 9999 ? minutes : null,
      rate: maxRate,
      level: currentLevel,
    };
  }, [sensorHistory]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PredictionPanel() {
  const prediction = useFloodStore((s) => s.prediction);
  const criticalMode = useFloodStore((s) => s.criticalMode);
  const alertLevel = useFloodStore((s) => s.alertLevel);
  const { minutes, rate } = useTimeToImpact();

  const prob = prediction?.flood_probability ?? 0;
  const method = prediction?.method ?? "no_data";

  return (
    <GlassCard className="w-64 flex flex-col" critical={criticalMode}>
      {/* ML Prediction */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-[10px] text-white/50 tracking-widest uppercase">
            ML Prediction
          </h2>
          <span className="font-mono text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
            {method === "xgboost" ? "XGBoost" : method === "rule_based" ? "Rules" : "Offline"}
          </span>
        </div>

        <RiskGauge probability={prob} alertLevel={alertLevel} />

        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div>
            <div className="font-mono text-[9px] text-white/30">MODEL</div>
            <div className="font-mono text-[11px] text-white/60">XGBoost v1</div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-white/30">ROC-AUC</div>
            <div className="font-mono text-[11px] text-emerald-400/80">0.94</div>
          </div>
        </div>
      </div>

      {/* Time to Impact */}
      <div className="p-4">
        <h2 className="font-mono text-[10px] text-white/50 tracking-widest uppercase mb-3">
          Time to Impact
        </h2>

        <div className="text-center">
          {minutes != null ? (
            <motion.div
              key={minutes}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={criticalMode ? "text-red-400" : "text-white/80"}
            >
              <span className="font-mono text-4xl font-bold">{minutes}</span>
              <span className="font-mono text-sm ml-1 text-white/40">min</span>
            </motion.div>
          ) : (
            <div className="font-mono text-2xl text-white/20">— —</div>
          )}
        </div>

        <div className="mt-3 flex justify-between font-mono text-[9px] text-white/30">
          <span>Rate: {(rate * 12).toFixed(3)} m/min</span>
          <span>Crest: 3.0m</span>
        </div>
      </div>

      {/* Feature highlights */}
      {prediction?.features_used && Object.keys(prediction.features_used).length > 0 && (
        <div className="px-4 pb-3 border-t border-white/5 pt-3">
          <h3 className="font-mono text-[9px] text-white/30 tracking-widest uppercase mb-2">
            Key Features
          </h3>
          <div className="space-y-0.5">
            {Object.entries(prediction.features_used)
              .slice(0, 5)
              .map(([key, val]) => (
                <div key={key} className="flex justify-between font-mono text-[9px]">
                  <span className="text-white/30 truncate max-w-[120px]">
                    {key.replace(/_/g, " ")}
                  </span>
                  <span className="text-white/50">{typeof val === "number" ? val.toFixed(3) : val}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
