// =============================================================================
// RapidRelay – Supabase History Hook
//
// Fetches historical sensor readings from Supabase on mount so the Data tab
// has persistent records that survive page reloads. Also hydrates the Zustand
// store with the last batch of readings so sensor cards show data immediately.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorSnapshot, SensorReading } from "@/lib/types";

interface SupabaseReading {
  sensor_id: string;
  water_level: number | null;
  rainfall: number | null;
  humidity: number | null;
  soil_moisture: number | null;
  temperature: number | null;
  latitude: number;
  longitude: number;
  is_valid: boolean;
  timestamp: string;
}

/**
 * Convert a batch of Supabase sensor_readings rows (same timestamp group)
 * into a SensorSnapshot for the Data tab history array.
 */
function rowsToSnapshot(rows: SupabaseReading[]): SensorSnapshot | null {
  if (rows.length === 0) return null;

  // Average across all nodes in this tick
  let waterLevel = 0;
  let rainfall = 0;
  let humidity = 0;
  let soilMoisture = 0;
  let count = 0;

  for (const r of rows) {
    waterLevel += r.water_level ?? 0;
    rainfall += r.rainfall ?? 0;
    humidity += r.humidity ?? 0;
    soilMoisture += r.soil_moisture ?? 0;
    count++;
  }

  if (count === 0) return null;
  waterLevel /= count;
  rainfall /= count;
  humidity /= count;
  soilMoisture /= count;

  const ts = new Date(rows[0].timestamp);
  const risk = Math.min(1, (waterLevel / 2.0) * 0.5 + (rainfall / 30) * 0.3 + (soilMoisture / 100) * 0.2);

  const mkReading = (val: number, warnThresh: number, critThresh: number): SensorReading => ({
    value: val,
    effectiveValue: val,
    isValid: true,
    timestamp: ts,
    status: val >= critThresh ? "critical" : val >= warnThresh ? "warning" : "normal",
  });

  return {
    timestamp: ts,
    waterLevel: mkReading(waterLevel, 1.0, 1.8),
    soilMoisture: mkReading(soilMoisture, 70, 90),
    humidity: mkReading(humidity, 85, 95),
    rainfall,
    floodExtent: Math.min(1, waterLevel / 2.5),
    wetnessTrend: 0,
    risk,
    overallStatus: risk > 0.7 ? "critical" : risk > 0.4 ? "warning" : "normal",
  };
}

/**
 * Fetch recent sensor history from Supabase and return as SensorSnapshot[].
 * Groups readings by timestamp (rounded to nearest 5s) to batch per-tick.
 */
export function useSupabaseHistory(
  setHistory: React.Dispatch<React.SetStateAction<SensorSnapshot[]>>
) {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    async function fetchHistory() {
      try {
        // Fetch last 500 readings (covers ~8 minutes at 5 nodes / 5s interval)
        const { data, error } = await supabase
          .from("sensor_readings")
          .select("sensor_id,water_level,rainfall,humidity,soil_moisture,temperature,latitude,longitude,is_valid,timestamp")
          .order("timestamp", { ascending: false })
          .limit(500);

        if (error || !data || data.length === 0) {
          console.log("[History] No Supabase data available, starting fresh");
          return;
        }

        console.log(`[History] Loaded ${data.length} readings from Supabase`);

        // Group by timestamp (rounded to 5s buckets)
        const groups = new Map<string, SupabaseReading[]>();
        for (const row of data as SupabaseReading[]) {
          const ts = new Date(row.timestamp);
          const bucket = new Date(Math.round(ts.getTime() / 5000) * 5000).toISOString();
          const existing = groups.get(bucket) || [];
          existing.push(row);
          groups.set(bucket, existing);
        }

        // Convert each group to a snapshot, sorted chronologically
        const snapshots: SensorSnapshot[] = [];
        const sortedKeys = Array.from(groups.keys()).sort();
        for (const key of sortedKeys) {
          const snap = rowsToSnapshot(groups.get(key)!);
          if (snap) snapshots.push(snap);
        }

        if (snapshots.length > 0) {
          setHistory(snapshots);
          console.log(`[History] Hydrated ${snapshots.length} snapshots from Supabase`);
        }

        // Also hydrate the Zustand store with the latest readings
        // so sensor cards show data immediately
        const latest = data.slice(0, 5); // Last 5 readings = last tick (5 nodes)
        if (latest.length > 0) {
          const features = latest.map((r: SupabaseReading) => ({
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [r.longitude, r.latitude] as [number, number],
            },
            properties: {
              sensor_id: r.sensor_id,
              name: r.sensor_id,
              type: "multi",
              latitude: r.latitude,
              longitude: r.longitude,
              water_level: r.water_level,
              rainfall: r.rainfall,
              humidity: r.humidity,
              temperature: r.temperature,
              soil_moisture: r.soil_moisture,
              is_valid: r.is_valid,
              timestamp: r.timestamp,
              flood_mode: false,
            },
          }));

          useFloodStore.getState().updateSensors({
            type: "FeatureCollection",
            features,
          });
        }
      } catch (err) {
        console.warn("[History] Failed to fetch from Supabase:", err);
      }
    }

    fetchHistory();
  }, [setHistory]);
}
