// =============================================================================
// RapidRelay – Simulated Sensor Data Generator
// Produces realistic readings for all three sensors with occasional failures
// to exercise the validation pipeline.
// =============================================================================

import type { SensorId, SensorSnapshot } from "./types"
import { SENSOR_REGISTRY, ALL_SENSOR_IDS } from "./constants"
import { validateReading, deriveOverallStatus } from "./sensor-validation"

/**
 * Internal state for realistic time-series simulation.
 * Each sensor tracks a base value that drifts smoothly.
 */
const simState: Record<SensorId, { base: number; trend: number }> = {
  ultrasonic_water_level: { base: 0.9, trend: 0 },
  capacitive_soil_moisture: { base: 42, trend: 0 },
  humidity_dht22: { base: 62, trend: 0 },
  rain_gauge: { base: 0.5, trend: 0 },
  risk_engine: { base: 0.2, trend: 0 },
  flood_mapper: { base: 0.05, trend: 0 },
}

/**
 * Probability of injecting a faulty reading (for hardening testing).
 * Kept very low so the UI looks smooth; the validation pipeline is
 * still exercised occasionally.
 */
const FAULT_INJECTION_RATE = 0.005 // 0.5% — rare but present

/**
 * Generates a new SensorSnapshot with realistic, smooth drift.
 *
 * Drift model:
 *  - A very slow random trend shifts the base value ±0.02% of range per tick
 *  - Gentle Gaussian-ish noise overlaid at ±0.8% of range
 *  - Mean-reversion keeps values near realistic baseline
 *  - Occasional fault injection (NaN, out-of-range spike)
 */
export function generateSnapshot(): SensorSnapshot {
  const now = new Date()

  const readings = ALL_SENSOR_IDS.map((id) => {
    const meta = SENSOR_REGISTRY[id]
    const state = simState[id]
    const range = meta.validRange.max - meta.validRange.min

    // Evolve trend very slowly (smooth, not jittery)
    state.trend += (Math.random() - 0.5) * 0.004
    state.trend = Math.max(-0.012, Math.min(0.012, state.trend))

    // Mean-reversion: gently pull base toward the midpoint of normal range
    const midpoint = meta.thresholds.warning * 0.5
    const reversion = (midpoint - state.base) * 0.002

    // Apply trend, reversion, and gentle noise
    state.base += state.trend * range + reversion
    const noise = (Math.random() - 0.5) * range * 0.008
    let rawValue = state.base + noise

    // Clamp to keep simulation in valid range
    rawValue = Math.max(meta.validRange.min + range * 0.05, Math.min(meta.validRange.max * 0.95, rawValue))

    // Fault injection (very rare)
    if (Math.random() < FAULT_INJECTION_RATE) {
      const faultType = Math.random()
      if (faultType < 0.33) {
        rawValue = NaN
      } else if (faultType < 0.66) {
        rawValue = meta.validRange.max + 50
      } else {
        rawValue = -999
      }
    }

    return validateReading(id, rawValue, now)
  })

  const waterLevelReading = readings.find((r) => r.sensorId === "ultrasonic_water_level")!
  const soilMoistureReading = readings.find((r) => r.sensorId === "capacitive_soil_moisture")!
  const humidityReading = readings.find((r) => r.sensorId === "humidity_dht22")!

  // Derive computed fields from primary sensor readings
  const wl = waterLevelReading.effectiveValue   // metres (0.0 – 3.0)
  const sm = soilMoistureReading.effectiveValue  // % (0 – 100)
  const rainState = simState["rain_gauge"]
  rainState.trend += (Math.random() - 0.5) * 0.02
  rainState.trend = Math.max(-0.05, Math.min(0.05, rainState.trend))
  rainState.base = Math.max(0, Math.min(80, rainState.base + rainState.trend * 10 + (Math.random() - 0.5) * 0.5))
  const rainfall = rainState.base

  // Flood extent: non-linear ramp from 0 at wl<0.6 to 1.0 at wl>2.5
  const floodExtent = Math.min(1, Math.max(0, (wl - 0.6) / 1.9))

  // Wetness trend: positive when rising, negative when falling
  const wetnessTrend = simState["ultrasonic_water_level"].trend * 10

  // Composite risk (0–1)
  const risk = Math.min(1, (
    (wl / 2.5) * 0.5 +
    (sm / 100) * 0.25 +
    (rainfall / 30) * 0.25
  ))

  const snapshot: SensorSnapshot = {
    soilMoisture: soilMoistureReading,
    waterLevel: waterLevelReading,
    humidity: humidityReading,
    rainfall,
    floodExtent,
    wetnessTrend,
    risk,
    overallStatus: "normal", // placeholder, computed below
    timestamp: now,
  }

  snapshot.overallStatus = deriveOverallStatus(snapshot)
  return snapshot
}

/**
 * Forces simulation toward a specific scenario (for testing/demo).
 */
export function setSimulationBase(sensorId: SensorId, value: number): void {
  simState[sensorId].base = value
  simState[sensorId].trend = 0
}
