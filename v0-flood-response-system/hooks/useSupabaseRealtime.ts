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
import type { SensorGeoJSON, Prediction, GeoJSONFeature } from "@/stores/sensorStore";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// Obando, Bulacan coordinates (sensor location)
const OBANDO_LAT = 14.7094;
const OBANDO_LNG = 120.9358;
const DIKE_HEIGHT_M = 4.038; // 13'3"

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

function toFeature(row: SupabaseRawReading): GeoJSONFeature {
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

/**
 * Subscribes to Supabase Realtime for live environmental data updates.
 */
export function useSupabaseRealtime() {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeRef = useRef(false);
  const retryRef = useRef({ count: 0, timer: 0 as unknown as number });
  const MAX_RETRIES = 6;

  const updateSensors = useFloodStore((s) => s.updateSensors);
  const updatePrediction = useFloodStore((s) => s.updatePrediction);
  const setWsStatus = useFloodStore((s) => s.setWsStatus);

  useEffect(() => {
    if (activeRef.current) return;
    activeRef.current = true;

    console.log("[Supabase Realtime] Connecting...");

    // Guard: ensure Supabase client has config
    try {
      const testUrl = (supabase as any).url || '';
      if (!testUrl) {
        console.warn('[Supabase Realtime] Supabase client not configured, skipping realtime.');
        setWsStatus('disabled');
        return;
      }
    } catch (e) {
      console.warn('[Supabase Realtime] Supabase client check failed:', e);
    }

    function createChannel() {
      // create a new channel instance each attempt
      return supabase
        .channel("realtime-environmental")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "obando_environmental_data" },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const row = payload.new as SupabaseRawReading;
          const feature = toFeature(row);

          // Replace or add the feature
          const current = useFloodStore.getState().sensorData;
          const existingIds = new Set(current.features.map((f) => f.properties.sensor_id));

          let features: GeoJSONFeature[];
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
            retryRef.current.count = 0;
            setWsStatus("connected");
          } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
            const attempts = retryRef.current.count || 0;
            // Only log error aggressively after a few attempts to avoid console spam
            if (attempts >= 1) {
              console.warn("[Supabase Realtime] Channel status:", status, "attempt", attempts);
            } else {
              console.debug("[Supabase Realtime] Channel status:", status, "attempt", attempts);
            }

            setWsStatus("error");

            if (attempts >= MAX_RETRIES) {
              console.error("[Supabase Realtime] Max reconnect attempts reached; giving up until manual reload.");
              return;
            }

            // attempt reconnect with exponential backoff
            const backoff = Math.min(30000, 1000 * Math.pow(2, attempts));
            retryRef.current.count = attempts + 1;

            // cleanup previous channel and timer
            if (retryRef.current.timer) {
              clearTimeout(retryRef.current.timer as unknown as number);
              retryRef.current.timer = 0 as unknown as number;
            }

            if (channelRef.current) {
              try {
                supabase.removeChannel(channelRef.current);
              } catch (e) {
                console.debug('[Supabase Realtime] removeChannel failed:', e);
              }
              channelRef.current = null;
            }

            // schedule reconnect
            retryRef.current.timer = window.setTimeout(() => {
              if (!activeRef.current) return;
              try {
                const newChannel = createChannel();
                channelRef.current = newChannel;
              } catch (e) {
                console.error('[Supabase Realtime] Reconnect attempt failed:', e);
              }
            }, backoff) as unknown as number;
          }
        });

      }

    const channel = createChannel();
    channelRef.current = channel;

    return () => {
      activeRef.current = false;
      if (retryRef.current.timer) {
        clearTimeout(retryRef.current.timer as unknown as number);
        retryRef.current.timer = 0 as unknown as number;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [updateSensors, updatePrediction, setWsStatus]);
}
