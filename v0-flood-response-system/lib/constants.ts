// =============================================================================
// RapidRelay – Deployment Constants & Sensor Definitions
// Location: PAGASA – Obando, Bulacan (near dike / flood gate)
// =============================================================================

import type { SensorMeta, SensorId } from "./types"

// ---------------------------------------------------------------------------
// Deployment Location
// ---------------------------------------------------------------------------

export const DEPLOYMENT = {
  name: "PAGASA – Obando, Bulacan",
  shortName: "Obando Station",
  description:
    "Flood monitoring station near the Obando dike and flood gate system, " +
    "positioned to detect tidal surges from Manila Bay, overflow from the " +
    "Meycauayan–Obando–Marilao river system, and localized pluvial flooding.",
  coordinates: { lat: 14.7094, lng: 120.9358 },
  /** Map default zoom level */
  mapZoom: 15,
  /** The area is low-lying, avg 2–4 m above sea level */
  elevationM: 3,
  /** Typical tidal range in Manila Bay affecting Obando */
  tidalRangeM: { low: 0.2, high: 1.8 },
  /**
   * Flood-prone polygon corners (approximate area around dike).
   * Used for the map overlay.
   */
  /**
   * Defined Flood Zones for Segmented Map Visualization.
   * Representing different areas of impact around the Obando Mega Dike.
   */
  FLOOD_ZONES: [
    {
      id: "zone_a",
      name: "Zone A: Dike Frontage (Critical)",
      color: "#ef4444", // Red base
      coordinates: [
        [14.7110, 120.9340],
        [14.7110, 120.9380],
        [14.7075, 120.9380],
        [14.7075, 120.9340],
      ] as [number, number][],
    },
    {
      id: "zone_b",
      name: "Zone B: Tawiran-Paco (Residential)",
      color: "#f59e0b", // Orange base
      coordinates: [
        [14.7110, 120.9340],
        [14.7145, 120.9340],
        [14.7145, 120.9380],
        [14.7110, 120.9380],
      ] as [number, number][],
    },
    {
      id: "zone_c",
      name: "Zone C: Low-Lying Fields",
      color: "#3b82f6", // Blue base
      coordinates: [
        [14.7075, 120.9340],
        [14.7040, 120.9340],
        [14.7040, 120.9380],
        [14.7075, 120.9380],
      ] as [number, number][],
    },
  ],
  /**
   * Environmental notes for operators:
   * • Obando sits at the terminus of the Meycauayan River draining into
   *   Manila Bay. High tides + upstream rainfall create compound flooding.
   * • The dike and flood gates are the primary defense; sensor placement
   *   is immediately upstream and downstream of the gate structure.
   * • During southwest monsoon (habagat), sustained rainfall > 30 mm/hr
   *   combined with high tide creates critical risk within 30 minutes.
   */
  riskFactors: [
    "Tidal surge from Manila Bay",
    "Upstream river overflow (Meycauayan–Obando–Marilao system)",
    "Southwest monsoon (habagat) heavy rainfall",
    "Compound flooding: simultaneous tide + rain + river rise",
    "Dike/flood gate failure or overtopping",
  ],
} as const

// ---------------------------------------------------------------------------
// Sensor Definitions
// ---------------------------------------------------------------------------

/**
 * SENSOR_REGISTRY is the single source of truth for every sensor in the
 * deployment. No generic "Sensor 1/2/3" – each entry maps to a real device
 * with a clear physical role and calibrated thresholds.
 *
 * Threshold rationale (Obando dike context):
 *
 * Ultrasonic Water Level:
 *   - Measures distance from sensor to water surface, then inverted to
 *     water level relative to the dike base.
 *   - Normal: < 1.5 m  (typical dry-season / low-tide baseline)
 *   - Warning: 1.5–2.5 m  (rising tide + moderate rain)
 *   - Critical: > 2.5 m  (imminent overtopping of 3 m dike crest)
 *
 * Capacitive Soil Moisture:
 *   - Embedded in dike embankment to detect saturation that weakens
 *     structural integrity.
 *   - Normal: < 60 %  (well-drained compacted earth)
 *   - Warning: 60–80 %  (saturating; seepage risk)
 *   - Critical: > 80 %  (structural compromise risk)
 *
 * Humidity (DHT22):
 *   - Ambient air humidity correlates with imminent rainfall probability.
 *   - Normal: < 75 %
 *   - Warning: 75–90 %  (rain likely within 1 hour)
 *   - Critical: > 90 %  (heavy downpour imminent or ongoing)
 */
export const SENSOR_REGISTRY: Record<SensorId, SensorMeta> = {
  ultrasonic_water_level: {
    id: "ultrasonic_water_level",
    label: "Ultrasonic Water Level Sensor",
    shortLabel: "Water Level",
    description:
      "Single-transducer ultrasonic sensor measuring water surface distance. " +
      "Mounted on the upstream face of the dike, 4 m above base. Readings " +
      "are inverted to derive actual water level relative to dike base.",
    unit: "m",
    imperialUnit: "ft",
    validRange: { min: 0, max: 4.0 },
    thresholds: { warning: 1.5, critical: 2.5 },
    fallbackValue: 0.8,
    placement: "Upstream face of Obando dike, centered above flood gate",
  },
  capacitive_soil_moisture: {
    id: "capacitive_soil_moisture",
    label: "Capacitive Soil Moisture Sensor",
    shortLabel: "Soil Moisture",
    description:
      "Capacitive-type sensor embedded 0.5 m into the dike embankment to " +
      "measure volumetric water content. Detects saturation that could " +
      "compromise dike structural integrity.",
    unit: "%",
    imperialUnit: "%", // percentage is unit-agnostic
    validRange: { min: 0, max: 100 },
    thresholds: { warning: 60, critical: 80 },
    fallbackValue: 35,
    placement: "Embedded in dike embankment, mid-height, upstream side",
  },
  humidity_dht22: {
    id: "humidity_dht22",
    label: "Humidity Sensor (DHT22)",
    shortLabel: "Humidity",
    description:
      "DHT22 digital temperature-humidity sensor in weatherproof housing. " +
      "Provides ambient relative humidity as a proxy for imminent rainfall " +
      "probability in the Obando area.",
    unit: "%",
    imperialUnit: "%",
    validRange: { min: 0, max: 100 },
    thresholds: { warning: 75, critical: 90 },
    fallbackValue: 55,
    placement: "Mounted on dike-top railing, 1.5 m above crest",
  },
  rain_gauge: {
    id: "rain_gauge",
    label: "Optical Rain Gauge",
    shortLabel: "Rainfall",
    description: "Virtual sensor deriving precipitation rate from aggregated data or dedicated optical gauge.",
    unit: "mm/hr",
    imperialUnit: "in/hr",
    validRange: { min: 0, max: 500 },
    thresholds: { warning: 7.5, critical: 30 },
    fallbackValue: 0,
    placement: "Rooftop of monitoring station",
  },
  risk_engine: {
    id: "risk_engine",
    label: "Composite Risk Engine",
    shortLabel: "Risk Factor",
    description: "Computed metric combining water level, soil moisture, and rainfall data to assess overall flood probability.",
    unit: "%",
    imperialUnit: "%",
    validRange: { min: 0, max: 1 },
    thresholds: { warning: 0.5, critical: 0.8 },
    fallbackValue: 0,
    placement: "Cloud/Edge Compute Node",
  },
  flood_mapper: {
    id: "flood_mapper",
    label: "Flood Extent Estimator",
    shortLabel: "Flood Extent",
    description: "Geospatial projection of flooded area based on current water levels and topography.",
    unit: "%",
    imperialUnit: "%",
    validRange: { min: 0, max: 1 },
    thresholds: { warning: 0.2, critical: 0.5 },
    fallbackValue: 0,
    placement: "Cloud/Edge Compute Node",
  },
}

/** Ordered list of all sensor IDs for iteration */
export const ALL_SENSOR_IDS: SensorId[] = [
  "ultrasonic_water_level",
  "capacitive_soil_moisture",
  "humidity_dht22",
]

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** How often sensor data is polled / simulated (ms) */
export const SENSOR_POLL_INTERVAL_MS = 5_000

/** Max consecutive invalid readings before declaring sensor offline */
export const MAX_CONSECUTIVE_FAILURES = 5

/** How long to keep alert history in localStorage (ms) — 7 days */
export const ALERT_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Max alert records stored to prevent storage overflow */
export const MAX_ALERT_RECORDS = 500

/** Max historical data points kept in memory per sensor */
export const MAX_HISTORY_POINTS = 144 // 2 hours at 50 s intervals or 12 hours at 5 min

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  ALERTS: "rapidrelay_alerts",
  UNIT_PREFERENCE: "rapidrelay_unit",
  THEME: "theme",
  AUTH: "rapid_relay_auth",
  NOTIFICATION_PERMISSION: "rapidrelay_notif_perm",
  SYSTEM_HEALTH: "rapidrelay_health",
  LAST_SENSOR_SNAPSHOT: "rapidrelay_last_snapshot",
} as const

// ---------------------------------------------------------------------------
// Conversion Constants
// ---------------------------------------------------------------------------

export const METERS_TO_FEET = 3.28084
export const FEET_TO_METERS = 1 / METERS_TO_FEET
