// =============================================================================
// RapidRelay – Supabase History Hook
//
// Fetches historical environmental readings from Supabase on mount so the app
// has persistent records that survive page reloads. Also hydrates the Zustand
// store with the last batch of readings so sensor cards show data immediately.
// =============================================================================

"use client";

import { useEffect, useRef } from "react";
import { supabasePublic } from "@/lib/supabase";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorSnapshot, SensorReading } from "@/lib/types";

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

// Normalized reading for internal use
interface NormalizedReading {
  id: number;
  timestamp: string;
  soil: number;
  temperature: number;
  humidity: number;
  pressure: number;
  distance_m: number | null;
}

// Convert raw Supabase row to normalized reading
function normalizeReading(raw: SupabaseRawReading): NormalizedReading | null {
  let timestamp: string | null = null;
  if (raw["Date"] && raw["Time"]) {
    timestamp = `${raw["Date"]}T${raw["Time"]}`;
  } else if (raw["Date"]) {
    timestamp = `${raw["Date"]}T00:00:00`;
  }

  if (!timestamp) return null;

  return {
    id: raw.id,
    timestamp,
    soil: raw["Soil Moisture"],
    temperature: raw["Temperature"],
    humidity: raw["Humidity"],
    pressure: raw["Pressure"],
    distance_m: raw["Final Distance"],
  };
}

function toMillis(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Water level calculation constant
const DIKE_HEIGHT_M = 4.038; // 13'3" = 4.038 meters
const REFRESH_INTERVAL_MS = 20_000;

/**
 * Convert a batch of normalized readings into a SensorSnapshot for the History tab.
 */
function rowsToSnapshot(rows: NormalizedReading[]): SensorSnapshot | null {
  if (rows.length === 0) return null;

  // Average across all readings in this tick
  let waterLevel = 0;
  let soilMoisture = 0;
  let humidity = 0;
  let temperature = 0;
  let pressure = 0;
  let count = 0;

  for (const r of rows) {
    // Calculate water level: water_level = dike_height - distance_to_water
    const calcWaterLevel = (r.distance_m != null && r.distance_m >= 0)
      ? Math.max(0, DIKE_HEIGHT_M - r.distance_m)
      : 0;

    waterLevel += calcWaterLevel;
    soilMoisture += r.soil ?? 0;
    humidity += r.humidity ?? 0;
    temperature += r.temperature ?? 0;
    pressure += r.pressure ?? 0;
    count++;
  }

  if (count === 0) return null;
  waterLevel /= count;
  soilMoisture /= count;
  humidity /= count;
  temperature /= count;
  pressure /= count;

  const ts = new Date(rows[0].timestamp);
  const risk = Math.min(1, (waterLevel / 3.0) * 0.3 + (soilMoisture / 100) * 0.2 + (humidity / 100) * 0.2);

  const mkReading = (val: number, warnThresh: number, critThresh: number): SensorReading => ({
    value: val,
    effectiveValue: val,
    isValid: true,
    timestamp: ts,
    status: val >= critThresh ? "critical" : val >= warnThresh ? "warning" : "normal",
  });

  return {
    timestamp: ts,
    waterLevel: mkReading(waterLevel, 1.5, 2.5),
    soilMoisture: mkReading(soilMoisture, 60, 80),
    humidity: mkReading(humidity, 75, 90),
    temperature: mkReading(temperature, 35, 40), // °C thresholds
    pressure: mkReading(pressure, 950, 900), // hPa thresholds (lower is worse)
    rainfall: 0,
    floodExtent: Math.min(1, waterLevel / 3.0),
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
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    let active = true;

    async function fetchHistory() {
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      const timeout = setTimeout(() => {
        console.warn("[History] Supabase query timed out after 5s");
      }, 5000);

      try {
        // Fetch using actual Supabase column names (with spaces/quotes)
        const { data, error } = await supabasePublic
          .from("obando_environmental_data")
          .select('id, "Soil Moisture", "Temperature", "Humidity", "Pressure", "Final Distance", "Date", "Time", "Device"')
          .order("Date", { ascending: false, nullsFirst: false })
          .order("Time", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(500);

        clearTimeout(timeout);

        if (error) {
          console.error("[History] Supabase error:", error);
          return;
        }

        if (!data || data.length === 0) {
          console.log("[History] No Supabase data available, starting fresh");
          return;
        }

        console.log(`[History] Loaded ${data.length} readings from obando_environmental_data`);

        // Normalize all raw records and discard rows missing usable timestamps.
        const normalized = (data as SupabaseRawReading[])
          .map(normalizeReading)
          .filter((row): row is NormalizedReading => row !== null)
          .sort((a, b) => {
            const bTime = toMillis(b.timestamp);
            const aTime = toMillis(a.timestamp);
            if (bTime == null && aTime == null) return b.id - a.id;
            if (bTime == null) return -1;
            if (aTime == null) return 1;
            const delta = bTime - aTime;
            if (delta !== 0) return delta;
            return b.id - a.id;
          });

        // Group by timestamp (rounded to 1 minute buckets)
        const groups = new Map<string, NormalizedReading[]>();
        for (const row of normalized) {
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

        if (active && snapshots.length > 0) {
          setHistory(snapshots);
          console.log(`[History] Hydrated ${snapshots.length} snapshots from Supabase`);
        }

        // History is used for trends only.
        // Live status cards must come from realtime stream, not historical seed data.
      } catch (err) {
        clearTimeout(timeout);
        console.warn("[History] Failed to fetch from Supabase:", err);
      } finally {
        fetchingRef.current = false;
      }
    }

    void fetchHistory();

    const interval = window.setInterval(() => {
      void fetchHistory();
    }, REFRESH_INTERVAL_MS);

    const onFocus = () => {
      if (document.visibilityState === "visible") {
        void fetchHistory();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [setHistory]);
}
