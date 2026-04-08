// =============================================================================
// RapidRelay – Supabase Realtime Hook
//
// Subscribes to Supabase Realtime for live environmental data.
// Primary data source for production deployments.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorGeoJSON, Prediction } from "@/stores/sensorStore";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// Obando, Bulacan coordinates (sensor location)
const OBANDO_LAT = 14.7094;
const OBANDO_LNG = 120.9358;

/**
 * Subscribes to Supabase Realtime for live environmental data updates.
 */
export function useSupabaseRealtime() {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeRef = useRef(false);

  const updateSensors = useFloodStore((s) => s.updateSensors);
  const updatePrediction = useFloodStore((s) => s.updatePrediction);
  const setWsStatus = useFloodStore((s) => s.setWsStatus);

  useEffect(() => {
    if (activeRef.current) return;
    activeRef.current = true;

    console.log("[Supabase Realtime] Connecting...");

    const channel = supabase
      .channel("realtime-environmental")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "obando_environmental_data" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as Record<string, unknown>;

          // Build a GeoJSON feature from the environmental data
          // Note: Schema uses "Final Distance", "Soil Moisture", separate Date/Time
          const date = row.Date ? new Date(`${row.Date}T${row.Time || '00:00:00'}Z`).toISOString() : new Date().toISOString();

          const feature = {
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [OBANDO_LNG, OBANDO_LAT] as [number, number],
            },
            properties: {
              sensor_id: (row.Device as string) || "obando-main",
              name: "Obando Environmental Sensor",
              type: "multi",
              latitude: OBANDO_LAT,
              longitude: OBANDO_LNG,
              water_level: (row["Final Distance"] as number) ?? null,
              rainfall: null,
              humidity: (row.Humidity as number) ?? null,
              temperature: (row.Temperature as number) ?? null,
              soil_moisture: (row["Soil Moisture"] as number) ?? null,
              is_valid: true,
              timestamp: date,
              flood_mode: false,
            },
          };

          // Replace or add the feature
          const current = useFloodStore.getState().sensorData;
          const existingIds = new Set(current.features.map((f) => f.properties.sensor_id));

          let features;
          if (existingIds.has(feature.properties.sensor_id)) {
            features = current.features.map((f) =>
              f.properties.sensor_id === feature.properties.sensor_id ? feature : f
            );
          } else {
            features = [...current.features, feature];
          }

          const geojson: SensorGeoJSON = { type: "FeatureCollection", features };
          updateSensors(geojson);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "flood_predictions" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as Record<string, unknown>;
          const prediction: Prediction = {
            flood_probability: row.flood_probability as number,
            alert_level: ((row.risk_tier as string) ?? "NORMAL").toUpperCase() as Prediction["alert_level"],
            features_used: {},
            method: "rule_based" as Prediction["method"],
            timestamp: (row.timestamp as string) ?? new Date().toISOString(),
          };
          updatePrediction(prediction);
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          console.log("[Supabase Realtime] Connected");
          setWsStatus("connected");
        } else if (status === "CHANNEL_ERROR") {
          console.error("[Supabase Realtime] Error");
          setWsStatus("error");
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        activeRef.current = false;
      }
    };
  }, [updateSensors, updatePrediction, setWsStatus]);
}
