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

// Raw row from Supabase (actual column names with spaces/quotes)
interface SupabaseRawReading {
  id: number;
  "Soil Moisture": number;
  "Temperature": number;
  "Humidity": number;
  "Pressure": number;
  "Final Distance": number | null;
  "Date": string | null;
  "Time": string | null;
  "Device": string | null;
}

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
          const row = payload.new as SupabaseRawReading;

          // Combine Date and Time into a timestamp
          let timestamp = new Date().toISOString();
          if (row["Date"] && row["Time"]) {
            timestamp = `${row["Date"]}T${row["Time"]}`;
          } else if (row["Date"]) {
            timestamp = `${row["Date"]}T00:00:00`;
          }

          // Build a GeoJSON feature from the environmental data
          const feature = {
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [OBANDO_LNG, OBANDO_LAT] as [number, number],
            },
            properties: {
              sensor_id: "obando-main",
              name: "Obando Environmental Sensor",
              type: "multi",
              latitude: OBANDO_LAT,
              longitude: OBANDO_LNG,
              water_level: row["Final Distance"] ?? null,
              rainfall: null,
              humidity: row["Humidity"] ?? null,
              temperature: row["Temperature"] ?? null,
              soil_moisture: row["Soil Moisture"] ?? null,
              is_valid: true,
              timestamp: timestamp,
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
