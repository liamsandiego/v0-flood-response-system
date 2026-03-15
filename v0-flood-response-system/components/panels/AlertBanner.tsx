// =============================================================================
// RapidRelay – Alert Banner (Top — Conditional)
//
// Slides down from top when alert_level is WARNING or DANGER.
// Full-width glassmorphism bar with pulsing animation in DANGER mode.
// Includes acknowledge and barrier trigger buttons.
// =============================================================================

"use client";

import { useFloodStore } from "@/stores/sensorStore";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef } from "react";

// Pre-cached alarm audio
let alarmAudio: HTMLAudioElement | null = null;
function playAlarm() {
  try {
    if (!alarmAudio) {
      alarmAudio = new Audio("/sounds/siren.mp3");
      alarmAudio.loop = true;
      alarmAudio.volume = 0.6;
    }
    alarmAudio.play().catch(() => {});
  } catch {
    // Audio not available
  }
}
function stopAlarm() {
  if (alarmAudio) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  }
}

export default function AlertBanner() {
  const alertLevel = useFloodStore((s) => s.alertLevel);
  const alertMessage = useFloodStore((s) => s.alertMessage);
  const alertDismissed = useFloodStore((s) => s.alertDismissed);
  const criticalMode = useFloodStore((s) => s.criticalMode);
  const dismissAlert = useFloodStore((s) => s.dismissAlert);
  const prevLevelRef = useRef(alertLevel);

  const showBanner =
    !alertDismissed && alertMessage && (alertLevel === "DANGER" || alertLevel === "WARNING");

  // Play alarm on DANGER
  useEffect(() => {
    if (alertLevel === "DANGER" && prevLevelRef.current !== "DANGER") {
      playAlarm();
    } else if (alertLevel !== "DANGER") {
      stopAlarm();
    }
    prevLevelRef.current = alertLevel;
    return () => stopAlarm();
  }, [alertLevel]);

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 200 }}
          className={`
            fixed top-0 left-0 right-0 z-50
            backdrop-blur-xl border-b
            ${
              criticalMode
                ? "bg-red-950/80 border-red-500/50 shadow-lg shadow-red-500/20"
                : "bg-orange-950/70 border-orange-500/40"
            }
          `}
        >
          <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between">
            {/* Alert icon + message */}
            <div className="flex items-center gap-3">
              {/* Pulsing indicator */}
              <div className="relative">
                <div
                  className={`w-3 h-3 rounded-full ${
                    criticalMode ? "bg-red-500" : "bg-orange-500"
                  }`}
                />
                {criticalMode && (
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-red-500 animate-ping" />
                )}
              </div>

              <div>
                <p className="font-mono text-sm font-bold text-white tracking-wide">
                  {alertLevel === "DANGER" ? "⚠ FLOOD DANGER" : "⚠ FLOOD WARNING"}
                </p>
                <p className="font-mono text-[11px] text-white/70">{alertMessage}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={dismissAlert}
                className="font-mono text-[10px] px-3 py-1.5 rounded border border-white/20
                  text-white/60 hover:text-white hover:bg-white/10 transition-colors uppercase tracking-wider"
              >
                Acknowledge
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
