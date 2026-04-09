// =============================================================================
// RapidRelay – Sensor Validation & Sanity Checks
// =============================================================================

import type { SensorId, SensorReading, AlertLevel, SensorSnapshot } from "./types"
import { SENSOR_REGISTRY, MAX_CONSECUTIVE_FAILURES } from "./constants"

// ---------------------------------------------------------------------------
// Per-sensor state tracking (module-level, survives across calls)
// ---------------------------------------------------------------------------

interface SensorState {
  lastValidValue: number
  consecutiveFailures: number
  lastValidTimestamp: Date | null
}

const sensorStates: Record<SensorId, SensorState> = {
  ultrasonic_water_level: {
    lastValidValue: SENSOR_REGISTRY.ultrasonic_water_level.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  capacitive_soil_moisture: {
    lastValidValue: SENSOR_REGISTRY.capacitive_soil_moisture.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  humidity_dht22: {
    lastValidValue: SENSOR_REGISTRY.humidity_dht22.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  temperature_bme680: {
    lastValidValue: SENSOR_REGISTRY.temperature_bme680.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  pressure_bme680: {
    lastValidValue: SENSOR_REGISTRY.pressure_bme680.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  rain_gauge: {
    lastValidValue: SENSOR_REGISTRY.rain_gauge.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  risk_engine: {
    lastValidValue: SENSOR_REGISTRY.risk_engine.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
  flood_mapper: {
    lastValidValue: SENSOR_REGISTRY.flood_mapper.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  },
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a raw sensor reading against the sensor's valid range and
 * rate-of-change constraints. Returns a SensorReading with isValid flag
 * and an effectiveValue (either the raw value if valid, or the best
 * fallback available).
 *
 * Failure modes handled:
 * 1. NaN / undefined / null → fallback
 * 2. Out of valid range → fallback
 * 3. Sudden spike (> 50% change in one interval) → fallback with warning
 * 4. Sensor declared offline after MAX_CONSECUTIVE_FAILURES
 */
export function validateReading(
  sensorId: SensorId,
  rawValue: unknown,
  timestamp: Date = new Date()
): SensorReading {
  const meta = SENSOR_REGISTRY[sensorId]
  const state = sensorStates[sensorId]

  // Guard: non-numeric or missing value
  if (rawValue === null || rawValue === undefined || typeof rawValue !== "number" || Number.isNaN(rawValue)) {
    state.consecutiveFailures++
    return buildReading(sensorId, NaN, false, "Non-numeric or missing value", state.lastValidValue, timestamp)
  }

  const value = rawValue as number

  // Guard: out of physical range
  if (value < meta.validRange.min || value > meta.validRange.max) {
    state.consecutiveFailures++
    return buildReading(
      sensorId,
      value,
      false,
      `Out of range [${meta.validRange.min}–${meta.validRange.max}]: ${value}`,
      state.lastValidValue,
      timestamp
    )
  }

  // Guard: rate-of-change spike detection
  // Only apply if we have a previous valid reading
  if (state.lastValidTimestamp !== null) {
    const deltaValue = Math.abs(value - state.lastValidValue)
    const maxDelta = (meta.validRange.max - meta.validRange.min) * 0.5
    if (deltaValue > maxDelta) {
      state.consecutiveFailures++
      return buildReading(
        sensorId,
        value,
        false,
        `Spike detected: Δ${deltaValue.toFixed(2)} exceeds 50% of range`,
        state.lastValidValue,
        timestamp
      )
    }
  }

  // Valid reading – reset failure counter, update state
  state.consecutiveFailures = 0
  state.lastValidValue = value
  state.lastValidTimestamp = timestamp

  return buildReading(sensorId, value, true, undefined, value, timestamp)
}

function buildReading(
  sensorId: SensorId,
  value: number,
  isValid: boolean,
  invalidReason: string | undefined,
  effectiveValue: number,
  timestamp: Date
): SensorReading {
  return {
    sensorId,
    value,
    isValid,
    invalidReason,
    effectiveValue,
    timestamp,
    status: classifyLevel(sensorId, effectiveValue),
  }
}

// ---------------------------------------------------------------------------
// Level Classification
// ---------------------------------------------------------------------------

export function classifyLevel(sensorId: SensorId, value: number): AlertLevel {
  const { thresholds } = SENSOR_REGISTRY[sensorId]
  if (value >= thresholds.critical) return "critical"
  if (value >= thresholds.warning) return "warning"
  return "normal"
}

// ---------------------------------------------------------------------------
// Overall Status (worst-case across all sensors)
// ---------------------------------------------------------------------------

export function deriveOverallStatus(snapshot: SensorSnapshot): AlertLevel {
  const levels: AlertLevel[] = [
    snapshot.soilMoisture.status,
    snapshot.waterLevel.status,
    snapshot.humidity.status,
    snapshot.temperature.status,
    snapshot.pressure.status,
  ]
  if (levels.includes("critical")) return "critical"
  if (levels.includes("warning")) return "warning"
  return "normal"
}

// ---------------------------------------------------------------------------
// Sensor Health Queries
// ---------------------------------------------------------------------------

export function isSensorOnline(sensorId: SensorId): boolean {
  return sensorStates[sensorId].consecutiveFailures < MAX_CONSECUTIVE_FAILURES
}

export function getConsecutiveFailures(sensorId: SensorId): number {
  return sensorStates[sensorId].consecutiveFailures
}

export function getLastValidValue(sensorId: SensorId): number {
  return sensorStates[sensorId].lastValidValue
}

export function getLastValidTimestamp(sensorId: SensorId): Date | null {
  return sensorStates[sensorId].lastValidTimestamp
}

/** Force-reset a sensor's failure counter (used during recovery) */
export function resetSensorState(sensorId: SensorId): void {
  const meta = SENSOR_REGISTRY[sensorId]
  sensorStates[sensorId] = {
    lastValidValue: meta.fallbackValue,
    consecutiveFailures: 0,
    lastValidTimestamp: null,
  }
}

/** Reset all sensors (full system reinitialization) */
export function resetAllSensors(): void {
  for (const id of Object.keys(sensorStates) as SensorId[]) {
    resetSensorState(id)
  }
}
