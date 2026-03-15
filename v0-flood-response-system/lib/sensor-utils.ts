// =============================================================================
// RapidRelay – Sensor Utilities
//
// Converts Zustand store data (SensorGeoJSON + Prediction) into the
// SensorSnapshot shape that dashboard cards and graphs expect.
// =============================================================================

import type { AlertLevel, SensorSnapshot, SensorReading } from "@/lib/types"
import type {
  SensorGeoJSON,
  Prediction,
  SensorHistoryEntry,
} from "@/stores/sensorStore"

// Thresholds matching lib/constants.ts SENSOR_REGISTRY
const THRESHOLDS = {
  water_level: { warning: 1.5, critical: 2.5 },
  soil_moisture: { warning: 60, critical: 80 },
  humidity: { warning: 75, critical: 90 },
  rainfall: { warning: 7.5, critical: 30 },
} as const

/** Map backend alert levels to UI alert levels */
export function mapAlertLevel(
  level: "CLEAR" | "WATCH" | "WARNING" | "DANGER" | string
): AlertLevel {
  switch (level) {
    case "DANGER":
      return "critical"
    case "WARNING":
      return "warning"
    default:
      return "normal"
  }
}

function classify(
  value: number,
  thresholds: { warning: number; critical: number }
): AlertLevel {
  if (value >= thresholds.critical) return "critical"
  if (value >= thresholds.warning) return "warning"
  return "normal"
}

/**
 * Build a SensorSnapshot from the Zustand store's live data.
 *
 * Aggregates across all IoT node features (5 nodes in Obando deployment):
 * - water_level, soil_moisture, humidity: averaged
 * - rainfall: max across nodes
 * - risk, floodExtent: from ML prediction
 * - wetnessTrend: derived from prediction EO data or soil moisture slope
 */
export function buildSnapshotFromStore(
  sensorData: SensorGeoJSON,
  prediction: Prediction | null,
  sensorHistory?: Map<string, SensorHistoryEntry[]>
): SensorSnapshot | null {
  const features = sensorData.features
  if (features.length === 0) return null

  // Aggregate sensor values across all nodes
  let totalWater = 0
  let totalSoil = 0
  let totalHumidity = 0
  let maxRainfall = 0
  let count = 0

  for (const f of features) {
    const p = f.properties
    if (!p.is_valid) continue
    totalWater += p.water_level ?? 0
    totalSoil += p.soil_moisture ?? 0
    totalHumidity += p.humidity ?? 0
    maxRainfall = Math.max(maxRainfall, p.rainfall ?? 0)
    count++
  }

  if (count === 0) return null

  const avgWater = totalWater / count
  const avgSoil = totalSoil / count
  const avgHumidity = totalHumidity / count

  // Build individual sensor readings
  const now = new Date()

  const waterLevel: SensorReading = {
    sensorId: "ultrasonic_water_level",
    value: avgWater,
    isValid: true,
    effectiveValue: avgWater,
    timestamp: now,
    status: classify(avgWater, THRESHOLDS.water_level),
  }

  const soilMoisture: SensorReading = {
    sensorId: "capacitive_soil_moisture",
    value: avgSoil,
    isValid: true,
    effectiveValue: avgSoil,
    timestamp: now,
    status: classify(avgSoil, THRESHOLDS.soil_moisture),
  }

  const humidity: SensorReading = {
    sensorId: "humidity_dht22",
    value: avgHumidity,
    isValid: true,
    effectiveValue: avgHumidity,
    timestamp: now,
    status: classify(avgHumidity, THRESHOLDS.humidity),
  }

  // Risk and flood data from prediction
  const risk = prediction?.flood_probability ?? 0
  const floodExtent =
    prediction?.features_used?.flood_extent ?? 0

  // Wetness trend: use prediction EO data if available, else derive from history
  let wetnessTrend = 0
  if (prediction?.features_used?.wetness_trend != null) {
    wetnessTrend = prediction.features_used.wetness_trend
  } else if (sensorHistory && sensorHistory.size > 0) {
    // Derive from soil moisture slope across recent history
    const firstHistory = sensorHistory.values().next().value
    if (firstHistory && firstHistory.length >= 3) {
      const recent = firstHistory.slice(-5)
      const first = recent[0].humidity
      const last = recent[recent.length - 1].humidity
      wetnessTrend = last > first + 2 ? 1 : last < first - 2 ? -1 : 0
    }
  }

  // Overall status from prediction alert level or worst sensor status
  let overallStatus: AlertLevel = "normal"
  if (prediction) {
    overallStatus = mapAlertLevel(prediction.alert_level)
  } else {
    // Fallback: use worst sensor status
    const statuses = [waterLevel.status, soilMoisture.status, humidity.status]
    if (statuses.includes("critical")) overallStatus = "critical"
    else if (statuses.includes("warning")) overallStatus = "warning"
  }

  return {
    waterLevel,
    soilMoisture,
    humidity,
    rainfall: maxRainfall,
    floodExtent,
    wetnessTrend,
    risk,
    overallStatus,
    timestamp: now,
  }
}
