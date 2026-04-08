// =============================================================================
// RapidRelay – Supabase History Hook
//
// Fetches historical environmental readings from Supabase on mount so the app
// has persistent records that survive page reloads. Also hydrates the Zustand
// store with the last batch of readings so sensor cards show data immediately.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorSnapshot, SensorReading } from "@/lib/types";

interface SupabaseReading {
  id: number;
  timestamp: string;
  soil: number;
  temperature: number;
  humidity: number;
  pressure: number;
  distance_m: number | null;
}

/**
 * Convert a batch of Supabase obando_environmental_data rows
 * into a SensorSnapshot for the History tab.
 */
function rowsToSnapshot(rows: SupabaseReading[]): SensorSnapshot | null {
  if (rows.length === 0) return null;

  // Average across all readings in this tick (usually just 1 for this table)
  let waterLevel = 0;
  let soilMoisture = 0;
  let humidity = 0;
  let count = 0;

  for (const r of rows) {
    waterLevel += r.distance_m ?? 0;
    soilMoisture += r.soil ?? 0;
    humidity += r.humidity ?? 0;
    count++;
  }

  if (count === 0) return null;
  waterLevel /= count;
  soilMoisture /= count;
  humidity /= count;

  const ts = new Date(rows[0].timestamp);
  const risk = Math.min(1, (waterLevel / 2.0) * 0.5 + (soilMoisture / 100) * 0.3 + (humidity / 100) * 0.2);

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
    rainfall: 0,
    floodExtent: Math.min(1, waterLevel / 2.5),
    wetnessTrend: 0,
    risk,
    overallStatus: risk > 0.7 ? "critical" : risk > 0.4 ? "warning" : "normal",
  };
}

/**
 * Fetch recent environmental history from Supabase and return as SensorSnapshot[].
 * Groups readings by timestamp (rounded to nearest minute) to batch per-tick.
 */
export function useSupabaseHistory(
  setHistory: React.Dispatch<React.SetStateAction<SensorSnapshot[]>>
) {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    async function fetchHistory() {
      const timeout = setTimeout(() => {
        console.warn("[History] Supabase query timed out after 5s");
      }, 5000);

      try {
        // Fetch from obando_environmental_data (the actual table with data)
        const { data, error } = await supabase
          .from("obando_environmental_data")
          .select("id, timestamp, soil, temperature, humidity, pressure, distance_m")
          .order("timestamp", { ascending: false })
          .limit(500);

        clearTimeout(timeout);

        if (error || !data || data.length === 0) {
          console.log("[History] No Supabase data available, starting fresh");
          return;
        }

        console.log(`[History] Loaded ${data.length} readings from obando_environmental_data`);

        // Group by timestamp (rounded to 1 minute buckets)
        const groups = new Map<string, SupabaseReading[]>();
        for (const row of data as SupabaseReading[]) {
          const ts = new Date(row.timestamp);
          const bucket = new Date(Math.round(ts.getTime() / 60000) * 60000).toISOString();
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

        // Also hydrate the Zustand store with the latest reading
        // so sensor cards show data immediately (using a mock sensor location for Obando)
        const latest = data[0] as SupabaseReading;
        if (latest) {
          const OBANDO_LAT = 14.7094;
          const OBANDO_LNG = 120.9358;
          
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
              water_level: latest.distance_m,
              rainfall: null,
              humidity: latest.humidity,
              temperature: latest.temperature,
              soil_moisture: latest.soil,
              is_valid: true,
              timestamp: latest.timestamp,
              flood_mode: false,
            },
          };

          useFloodStore.getState().updateSensors({
            type: "FeatureCollection",
            features: [feature],
          });
        }
      } catch (err) {
        clearTimeout(timeout);
        console.warn("[History] Failed to fetch from Supabase:", err);
      }
    }

    fetchHistory();
  }, [setHistory]);
}
