// =============================================================================
// RapidRelay – Supabase Realtime Hook
//
// Subscribes to Supabase Realtime for live sensor data when the backend
// WebSocket is unavailable (deployed mode without FastAPI backend).
//
// Architecture:
//   - Backend running  → WebSocket delivers data → this hook stays idle
//   - Backend offline  → This hook subscribes to Supabase Realtime
//   - Both can coexist → WebSocket takes priority, Realtime is fallback
//
// Listens to INSERT events on: sensor_readings, flood_predictions
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorGeoJSON, Prediction } from "@/stores/sensorStore";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Activates Supabase Realtime subscription when WebSocket is disconnected.
 * Automatically pauses when WebSocket reconnects to avoid duplicate data.
 */
export function useSupabaseRealtime() {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeRef = useRef(false);

  const wsStatus = useFloodStore((s) => s.wsStatus);
  const updateSensors = useFloodStore((s) => s.updateSensors);
  const updatePrediction = useFloodStore((s) => s.updatePrediction);
  const setWsStatus = useFloodStore((s) => s.setWsStatus);

  useEffect(() => {
    // Only activate when WebSocket is disconnected or errored
    const shouldActivate = wsStatus === "disconnected" || wsStatus === "error";

    if (shouldActivate && !activeRef.current) {
      activeRef.current = true;

      const channel = supabase
        .channel("realtime-sensors")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "sensor_readings",
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;

            // Build a GeoJSON feature from the Supabase row
            const feature = {
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: [row.longitude as number, row.latitude as number] as [number, number],
              },
              properties: {
                sensor_id: row.sensor_id as string,
                name: row.sensor_id as string,
                type: "multi",
                latitude: row.latitude as number,
                longitude: row.longitude as number,
                water_level: (row.water_level as number) ?? null,
                rainfall: (row.rainfall as number) ?? null,
                humidity: (row.humidity as number) ?? null,
                temperature: (row.temperature as number) ?? null,
                soil_moisture: (row.soil_moisture as number) ?? null,
                is_valid: (row.is_valid as boolean) ?? true,
                timestamp: row.timestamp as string,
                flood_mode: false,
              },
            };

            // Accumulate features and dispatch as a batch
            // (Supabase sends one row at a time, but we need a FeatureCollection)
            const current = useFloodStore.getState().sensorData;
            const existingIds = new Set(current.features.map((f) => f.properties.sensor_id));

            let features;
            if (existingIds.has(feature.properties.sensor_id)) {
              // Replace the existing feature for this sensor
              features = current.features.map((f) =>
                f.properties.sensor_id === feature.properties.sensor_id ? feature : f
              );
            } else {
              features = [...current.features, feature];
            }

            const geojson: SensorGeoJSON = {
              type: "FeatureCollection",
              features,
            };

            updateSensors(geojson);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "flood_predictions",
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            const prediction: Prediction = {
              flood_probability: row.flood_probability as number,
              alert_level: (row.alert_level as string).toUpperCase() as Prediction["alert_level"],
              features_used: row.features_json ? JSON.parse(row.features_json as string) : {},
              method: (row.method as string) as Prediction["method"] ?? "rule_based",
              timestamp: (row.predicted_at as string) ?? new Date().toISOString(),
            };
            updatePrediction(prediction);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("[Supabase Realtime] Subscribed — live sensor feed active");
            // Show as connected via Supabase (not WebSocket)
            if (useFloodStore.getState().wsStatus !== "connected") {
              setWsStatus("connected");
            }
          }
        });

      channelRef.current = channel;
    }

    // Unsubscribe when WebSocket reconnects
    if (!shouldActivate && activeRef.current) {
      activeRef.current = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        console.log("[Supabase Realtime] Paused — WebSocket is active");
      }
    }

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        activeRef.current = false;
      }
    };
  }, [wsStatus, updateSensors, updatePrediction, setWsStatus]);
}
