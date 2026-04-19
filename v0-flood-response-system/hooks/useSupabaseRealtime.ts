// =============================================================================
// RapidRelay – Supabase Realtime Hook
//
// Subscribes to Supabase Realtime for live environmental data.
// Primary data source for production deployments.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabase, supabasePublic } from "@/lib/supabase";
import { logTelemetry } from "@/lib/realtimeTelemetry";
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
  const maxRetriesLoggedRef = useRef(false);

  const MAX_RETRIES = 6;
  const pollIntervalRef = useRef(0 as unknown as number | null);

  const updateSensors = useFloodStore((s) => s.updateSensors);
  const updatePrediction = useFloodStore((s) => s.updatePrediction);
  const setWsStatus = useFloodStore((s) => s.setWsStatus);

  useEffect(() => {
        async function teardownChannel(channel: RealtimeChannel | null) {
          if (!channel) return;
          try {
            await channel.unsubscribe();
          } catch (e) {
            console.debug("[Supabase Realtime] unsubscribe failed:", e);
          }
          try {
            await supabase.removeChannel(channel);
          } catch (e) {
            console.debug("[Supabase Realtime] removeChannel failed:", e);
          }
        }

    if (activeRef.current) return;
    activeRef.current = true;

    console.log("[Supabase Realtime] Connecting...");
    logTelemetry("realtime.connect", "attempting connection");
    setWsStatus("connecting");

    // Guard: ensure environment variables are present (avoid unreliable runtime client introspection)
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn("[Supabase Realtime] Supabase env vars missing, realtime disabled.");
      setWsStatus("disabled");
      return;
    }

    function stopPollingFallback() {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current as unknown as number);
        pollIntervalRef.current = null;
      }
    }

    function startPollingFallback() {
      if (pollIntervalRef.current) return;

      const poll = async () => {
        try {
          const { data, error } = await supabasePublic
            .from("obando_environmental_data")
            .select('id, "Soil Moisture", "Temperature", "Humidity", "Pressure", "Final Distance", "Date", "Time", "Device"')
            .order("id", { ascending: false })
            .limit(50);

          if (error) {
            console.warn("[Supabase Poll] error", error.message);
            logTelemetry("realtime.poll.error", error.message);
            return;
          }
          if (!data || data.length === 0) return;

          // Keep only latest row per sensor to prevent duplicated stacked markers
          // and history spikes while fallback polling is active.
          const bySensor = new Map<string, SupabaseRawReading>();
          for (const row of data as SupabaseRawReading[]) {
            const sensorId = row["Device"] || "obando-main";
            if (!bySensor.has(sensorId)) {
              bySensor.set(sensorId, row);
            }
          }

          const features = Array.from(bySensor.values()).map((row) => toFeature(row));
          const geojson: SensorGeoJSON = { type: "FeatureCollection", features };
          updateSensors(geojson);
          setWsStatus("polling");
          logTelemetry("realtime.poll.success", undefined, {
            rows: (data as SupabaseRawReading[]).length,
            sensors: features.length,
          });
        } catch (e) {
          console.warn("[Supabase Poll] failed", e);
          logTelemetry("realtime.poll.failed", String(e));
        }
      };

      void poll();
      pollIntervalRef.current = window.setInterval(poll, 5000) as unknown as number;
    }

    function scheduleReconnect() {
      if (!activeRef.current) return;
      if (retryRef.current.timer) return;

      const attempts = retryRef.current.count || 0;
      const backoff = Math.min(30000, 1000 * Math.pow(2, attempts));
      retryRef.current.count = attempts + 1;

      if (!pollIntervalRef.current) {
        setWsStatus("connecting");
      }

      retryRef.current.timer = window.setTimeout(async () => {
        retryRef.current.timer = 0 as unknown as number;
        if (!activeRef.current) return;

        const previous = channelRef.current;
        channelRef.current = null;
        await teardownChannel(previous);

        const nextChannel = createChannel();
        channelRef.current = nextChannel;
      }, backoff) as unknown as number;
    }

    function createChannel() {
      const channel = supabase
        .channel("realtime-environmental")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "obando_environmental_data" },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            const row = payload.new as SupabaseRawReading;
            try {
              logTelemetry("realtime.insert.received", undefined, { id: row.id, device: row.Device });
            } catch {
              // no-op
            }

            const feature = toFeature(row);

            // Replace or add by sensor_id to avoid duplicate map points.
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
          // Ignore events from stale channels after reconnect switched refs.
          if (!activeRef.current || channelRef.current !== channel) return;

          if (status === "SUBSCRIBED") {
            console.log("[Supabase Realtime] Connected");
            retryRef.current.count = 0;
            maxRetriesLoggedRef.current = false;
            setWsStatus("connected");
            stopPollingFallback();
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "CLOSED" || status === "TIMED_OUT") {
            const attempts = retryRef.current.count || 0;

            if (attempts >= 1) {
              console.warn("[Supabase Realtime] Channel status:", status, "attempt", attempts);
            } else {
              console.debug("[Supabase Realtime] Channel status:", status, "attempt", attempts);
            }

            setWsStatus(pollIntervalRef.current ? "polling" : "error");
            logTelemetry("realtime.channel_status", String(status), { attempts });

            if (attempts >= MAX_RETRIES) {
              if (!maxRetriesLoggedRef.current) {
                console.error("[Supabase Realtime] Max reconnect attempts reached; starting fallback polling and continuing reconnect attempts in background.");
                maxRetriesLoggedRef.current = true;
              }
              logTelemetry("realtime.max_retries", "starting fallback polling", { attempts });
              startPollingFallback();
              setWsStatus("polling");
            }

            // Stop channel-level internal rejoin loop before app-level retry backoff.
            if (channelRef.current === channel) {
              channelRef.current = null;
              void teardownChannel(channel);
            }

            scheduleReconnect();
          }
        });

      return channel;
    }

    const channel = createChannel();
    channelRef.current = channel;

    return () => {
      activeRef.current = false;

      if (retryRef.current.timer) {
        clearTimeout(retryRef.current.timer as unknown as number);
        retryRef.current.timer = 0 as unknown as number;
      }

      stopPollingFallback();

      const activeChannel = channelRef.current;
      channelRef.current = null;
      if (activeChannel) {
        void teardownChannel(activeChannel);
      }
    };
  }, [updateSensors, updatePrediction, setWsStatus]);
}
