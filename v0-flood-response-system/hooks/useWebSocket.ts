// =============================================================================
// RapidRelay – WebSocket Hook
//
// Connects to backend v0.2.0 WebSocket for real-time sensor + prediction data.
// Auto-reconnects with exponential backoff (1s, 2s, 4s, ... max 30s).
// Uses Zustand store as the single sink for all incoming data.
// =============================================================================

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorGeoJSON, Prediction } from "@/stores/sensorStore";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/api/ws";
const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

interface WSMessage {
  type: string;
  data?: SensorGeoJSON;
  prediction?: Prediction | null;
  clients?: number;
  tick?: number;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(MIN_RECONNECT_DELAY);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const updateSensors = useFloodStore((s) => s.updateSensors);
  const updatePrediction = useFloodStore((s) => s.updatePrediction);
  const setWsStatus = useFloodStore((s) => s.setWsStatus);
  const setTick = useFloodStore((s) => s.setTick);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setWsStatus("connecting");

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setWsStatus("connected");
        reconnectDelay.current = MIN_RECONNECT_DELAY;
        console.log("[WS] Connected to", WS_URL);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg: WSMessage = JSON.parse(event.data);

          if (msg.type === "sensor_update") {
            if (msg.data) updateSensors(msg.data);
            if (msg.prediction) updatePrediction(msg.prediction);
            if (msg.tick !== undefined) setTick(msg.tick, msg.clients ?? 0);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setWsStatus("disconnected");
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setWsStatus("error");
        ws.close();
      };
    } catch {
      setWsStatus("error");
      scheduleReconnect();
    }
  }, [updateSensors, updatePrediction, setWsStatus, setTick]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);

    reconnectTimer.current = setTimeout(() => {
      reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay.current);
  }, [connect]);

  // Send a command to the backend (e.g., trigger flood test)
  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { send };
}
