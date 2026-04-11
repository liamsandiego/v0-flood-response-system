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
  temperature: { warning: 35, critical: 40 },
  pressure: { warning: 950, critical: 900 },
  rainfall: { warning: 7.5, critical: 30 },
} as const

const SENSOR_STATUS_FRESHNESS_MS = 5 * 60 * 1000

function isFreshFeatureTimestamp(timestamp: string | null | undefined): boolean {
  if (!timestamp) return false
  const parsed = new Date(timestamp).getTime()
  if (!Number.isFinite(parsed)) return false
  return Date.now() - parsed <= SENSOR_STATUS_FRESHNESS_MS
}

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

function makeUnavailableReading(
  sensorId: SensorReading["sensorId"],
  timestamp: Date
): SensorReading {
  return {
    sensorId,
    value: Number.NaN,
    isValid: false,
    invalidReason: "No realtime data",
    effectiveValue: Number.NaN,
    timestamp,
    status: "normal",
  }
}

function classifyInverse(
  value: number,
  thresholds: { warning: number; critical: number }
): AlertLevel {
  // For sensors where lower values are more dangerous (e.g., barometric pressure).
  if (value <= thresholds.critical) return "critical"
  if (value <= thresholds.warning) return "warning"
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
  let totalTemperature = 0
  let totalPressure = 0
  let waterCount = 0
  let soilCount = 0
  let humidityCount = 0
  let temperatureCount = 0
  let pressureCount = 0
  let maxRainfall = 0
  let count = 0
  let latestFreshTimestampMs = 0

  for (const f of features) {
    const p = f.properties
    if (!p.is_valid) continue
    if (!isFreshFeatureTimestamp(p.timestamp)) continue
    const ts = new Date(p.timestamp).getTime()
    if (Number.isFinite(ts)) {
      latestFreshTimestampMs = Math.max(latestFreshTimestampMs, ts)
    }
    if (typeof p.water_level === "number") {
      totalWater += p.water_level
      waterCount++
    }
    if (typeof p.soil_moisture === "number") {
      totalSoil += p.soil_moisture
      soilCount++
    }
    if (typeof p.humidity === "number") {
      totalHumidity += p.humidity
      humidityCount++
    }
    if (typeof p.temperature === "number") {
      totalTemperature += p.temperature
      temperatureCount++
    }
    if (typeof p.pressure === "number") {
      totalPressure += p.pressure
      pressureCount++
    }
    maxRainfall = Math.max(maxRainfall, p.rainfall ?? 0)
    count++
  }

  if (count === 0) return null

  const avgWater = waterCount > 0 ? totalWater / waterCount : null
  const avgSoil = soilCount > 0 ? totalSoil / soilCount : null
  const avgHumidity = humidityCount > 0 ? totalHumidity / humidityCount : null
  const avgTemperature = temperatureCount > 0 ? totalTemperature / temperatureCount : null
  const avgPressure = pressureCount > 0 ? totalPressure / pressureCount : null

  // Build individual sensor readings
  const sourceTimestamp = latestFreshTimestampMs > 0 ? new Date(latestFreshTimestampMs) : new Date()

  const waterLevel: SensorReading =
    avgWater == null
      ? makeUnavailableReading("ultrasonic_water_level", sourceTimestamp)
      : {
          sensorId: "ultrasonic_water_level",
          value: avgWater,
          isValid: true,
          effectiveValue: avgWater,
          timestamp: sourceTimestamp,
          status: classify(avgWater, THRESHOLDS.water_level),
        }

  const soilMoisture: SensorReading =
    avgSoil == null
      ? makeUnavailableReading("capacitive_soil_moisture", sourceTimestamp)
      : {
          sensorId: "capacitive_soil_moisture",
          value: avgSoil,
          isValid: true,
          effectiveValue: avgSoil,
          timestamp: sourceTimestamp,
          status: classify(avgSoil, THRESHOLDS.soil_moisture),
        }

  const humidity: SensorReading =
    avgHumidity == null
      ? makeUnavailableReading("humidity_dht22", sourceTimestamp)
      : {
          sensorId: "humidity_dht22",
          value: avgHumidity,
          isValid: true,
          effectiveValue: avgHumidity,
          timestamp: sourceTimestamp,
          status: classify(avgHumidity, THRESHOLDS.humidity),
        }

  const temperature: SensorReading =
    avgTemperature == null
      ? makeUnavailableReading("temperature_bme680", sourceTimestamp)
      : {
          sensorId: "temperature_bme680",
          value: avgTemperature,
          isValid: true,
          effectiveValue: avgTemperature,
          timestamp: sourceTimestamp,
          status: classify(avgTemperature, THRESHOLDS.temperature),
        }

  const pressure: SensorReading =
    avgPressure == null
      ? makeUnavailableReading("pressure_bme680", sourceTimestamp)
      : {
          sensorId: "pressure_bme680",
          value: avgPressure,
          isValid: true,
          effectiveValue: avgPressure,
          timestamp: sourceTimestamp,
          status: classifyInverse(avgPressure, THRESHOLDS.pressure),
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
    const statuses = [waterLevel.status, soilMoisture.status, humidity.status, temperature.status, pressure.status]
    if (statuses.includes("critical")) overallStatus = "critical"
    else if (statuses.includes("warning")) overallStatus = "warning"
  }

  return {
    waterLevel,
    soilMoisture,
    humidity,
    temperature,
    pressure,
    rainfall: maxRainfall,
    floodExtent,
    wetnessTrend,
    risk,
    overallStatus,
    timestamp: sourceTimestamp,
  }
}
