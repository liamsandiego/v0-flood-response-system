// =============================================================================
// hooks/useLocalSSE.ts — SSE-based realtime hook (replaces Supabase Realtime)
//
// Connects to /api/sse (Server-Sent Events) for live sensor data.
// Falls back to polling /api/readings every 10s if SSE is unavailable.
// Feeds data into the same Zustand store used by useWebSocket.
// =============================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorGeoJSON } from "@/stores/sensorStore";

// Obando sensor location — Upstream face of Obando dike (PAGASA station)
const SENSOR_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  "default": { lat: 14.707225, lon: 120.937613, name: "Obando Dike" },
};

function readingToFeature(reading: Record<string, unknown>) {
  const sensorId = reading.sensor_id as string;
  const coords = SENSOR_COORDS["default"];
  return {
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [coords.lon, coords.lat] as [number, number],
    },
    properties: {
      sensor_id: sensorId,
      name: coords.name,
      type: "multi",
      latitude: coords.lat,
      longitude: coords.lon,
      water_level: reading.validated_m as number | null,
      rainfall: null,
      humidity: null,
      temperature: null,
      soil_moisture: null,
      pressure: null,
      is_valid: Boolean(reading.constraint_pass),
      timestamp: reading.created_at as string,
      flood_mode: (reading.alert_level as string) !== "NORMAL",
      alert_level: reading.alert_level as string,
      uncertainty: reading.uncertainty as number | null,
      requires_human: Boolean(reading.requires_human),
      explanation: reading.explanation ?? null,
    },
  };
}

export interface LocalSSEStatus {
  connected: boolean;
  lastUpdate: Date | null;
  sensorOffline: boolean; // true if no update in >30s
  unsyncedCount: number;
  activeSensors: number;
}

export function useLocalSSE(): LocalSSEStatus {
  const updateSensors = useFloodStore((s) => s.updateSensors);
  const setWsStatus = useFloodStore((s) => s.setWsStatus);

  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastUpdateRef = useRef<Date | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<LocalSSEStatus>({
    connected: false,
    lastUpdate: null,
    sensorOffline: false,
    unsyncedCount: 0,
    activeSensors: 0,
  });

  // Track known features so we can merge updates
  const featuresRef = useRef<Map<string, ReturnType<typeof readingToFeature>>>(new Map());

  function mergeFeature(feature: ReturnType<typeof readingToFeature>) {
    featuresRef.current.set(feature.properties.sensor_id, feature);
    const geojson: SensorGeoJSON = {
      type: "FeatureCollection",
      features: Array.from(featuresRef.current.values()),
    };
    updateSensors(geojson);
  }

  function scheduleOfflineCheck() {
    if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    offlineTimerRef.current = setTimeout(() => {
      setStatus((prev) => ({ ...prev, sensorOffline: true }));
    }, 30_000);
  }

  function onReading(reading: Record<string, unknown>) {
    lastUpdateRef.current = new Date();
    const feature = readingToFeature(reading);
    mergeFeature(feature);
    scheduleOfflineCheck();
  }

  function connectSSE() {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource("/api/sse");
    esRef.current = es;

    es.onopen = () => {
      setWsStatus("connected");
      setStatus((prev) => ({ ...prev, connected: true, sensorOffline: false }));
      scheduleOfflineCheck();
    };

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "sensor_update" && payload.reading) {
          onReading(payload.reading);
          setStatus((prev) => ({
            ...prev,
            connected: true,
            sensorOffline: false,
            lastUpdate: new Date(),
            unsyncedCount: payload.unsynced ?? prev.unsyncedCount,
            activeSensors: payload.active_sensors ?? prev.activeSensors,
          }));
        } else if (payload.type === "heartbeat") {
          setStatus((prev) => ({
            ...prev,
            connected: true,
            unsyncedCount: payload.unsynced ?? prev.unsyncedCount,
            activeSensors: payload.active_sensors ?? 0,
          }));
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setWsStatus("disconnected");
      setStatus((prev) => ({ ...prev, connected: false }));
      es.close();
      esRef.current = null;
      // Fallback: start polling
      startPolling();
    };
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/readings?limit=10");
        if (!res.ok) return;
        const data = await res.json();
        if (data.readings?.length > 0) {
          const latest = data.readings[0];
          onReading(latest);
          setStatus((prev) => ({
            ...prev,
            lastUpdate: new Date(),
            sensorOffline: false,
          }));
        }
      } catch {
        // polling error — network down
      }
    }, 10_000);
  }

  useEffect(() => {
    connectSSE();
    return () => {
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return status;
}
