// =============================================================================
// RapidRelay – Supabase Realtime Hook
//
// Subscribes to Supabase Realtime for live environmental data.
// Primary data source for production deployments.
//
// IMPORTANT: Listens to live inserts from obando_environmental_data.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabasePublic } from "@/lib/supabase";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorGeoJSON, Prediction } from "@/stores/sensorStore";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// Obando, Bulacan coordinates (sensor location)
const OBANDO_LAT = 14.7094;
const OBANDO_LNG = 120.9358;

// Water level calculation constant
const DIKE_HEIGHT_M = 4.038; // 13'3" = 4.038 meters

// Raw row from Supabase obando_environmental_data table
interface SupabaseRawReading {
  id: number;
  "Soil Moisture": number | null;
  "Temperature": number | null;
  "Humidity": number | null;
  "Pressure": number | null;
  "Final Distance": number | null;
  "Date": string | null;
  "Time": string | null;
  "Device": string | null;
}

function toTimestamp(row: SupabaseRawReading): string {
  if (row["Date"] && row["Time"]) return `${row["Date"]}T${row["Time"]}`;
  if (row["Date"]) return `${row["Date"]}T00:00:00`;
  return new Date().toISOString();
}

function toWaterLevel(distance: number | null): number | null {
  if (typeof distance !== "number" || distance < 0) return null;
  return Math.max(0, DIKE_HEIGHT_M - distance);
}

function toFeature(row: SupabaseRawReading) {
  return {
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [OBANDO_LNG, OBANDO_LAT] as [number, number],
    },
    properties: {
      sensor_id: row["Device"] || "obando-main",
      name: "Obando Environmental Sensor",
      type: "multi",
      latitude: OBANDO_LAT,
      longitude: OBANDO_LNG,
      water_level: toWaterLevel(row["Final Distance"]),
      rainfall: null,
      humidity: row["Humidity"] ?? null,
      temperature: row["Temperature"] ?? null,
      soil_moisture: row["Soil Moisture"] ?? null,
      pressure: row["Pressure"] ?? null,
      is_valid: true,
      timestamp: toTimestamp(row),
      flood_mode: false,
    },
  };
}

function upsertFeature(feature: ReturnType<typeof toFeature>, updateSensors: (geojson: SensorGeoJSON) => void) {
  const current = useFloodStore.getState().sensorData;
  const existingIds = new Set(current.features.map((f) => f.properties.sensor_id));
  const features = existingIds.has(feature.properties.sensor_id)
    ? current.features.map((f) => (f.properties.sensor_id === feature.properties.sensor_id ? feature : f))
    : [...current.features, feature];

  updateSensors({ type: "FeatureCollection", features });
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

    async function hydrateLatestRows() {
      try {
        const { data: latestEnv, error: envErr } = await supabasePublic
          .from("obando_environmental_data")
          .select('id, "Soil Moisture", "Temperature", "Humidity", "Pressure", "Final Distance", "Date", "Time", "Device"')
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!envErr && latestEnv) {
          upsertFeature(toFeature(latestEnv as SupabaseRawReading), updateSensors);
        }

        const { data: latestPred, error: predErr } = await supabasePublic
          .from("flood_predictions")
          .select("timestamp, flood_probability, risk_tier")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!predErr && latestPred) {
          updatePrediction({
            flood_probability: Number(latestPred.flood_probability ?? 0),
            alert_level: String(latestPred.risk_tier ?? "NORMAL").toUpperCase() as Prediction["alert_level"],
            features_used: {},
            method: "rule_based" as Prediction["method"],
            timestamp: (latestPred.timestamp as string) ?? new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn("[Supabase Realtime] Initial hydration failed:", err);
      }
    }

    hydrateLatestRows();

    const channel = supabasePublic
      .channel("realtime-environmental")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "obando_environmental_data" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as SupabaseRawReading;
          upsertFeature(toFeature(row), updateSensors);
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
      .subscribe((status: string, err?: Error) => {
        if (status === "SUBSCRIBED") {
          console.log("[Supabase Realtime] Connected");
          hydrateLatestRows();
          setWsStatus("connected");
        } else if (status === "CHANNEL_ERROR") {
          console.error("[Supabase Realtime] Channel Error:", err);
          console.error("[Supabase Realtime] This usually means:");
          console.error("  1. Table 'obando_environmental_data' doesn't have Realtime enabled in Supabase");
          console.error("  2. RLS policies are blocking the subscription");
          console.error("  3. Check Supabase Dashboard → Database → Replication → Enable for this table");
          setWsStatus("error");
        } else {
          console.log("[Supabase Realtime] Status:", status);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabasePublic.removeChannel(channelRef.current);
        channelRef.current = null;
        activeRef.current = false;
      }
    };
  }, [updateSensors, updatePrediction, setWsStatus]);
}
