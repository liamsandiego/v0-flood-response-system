// =============================================================================
// RapidRelay – Alert Engine
// Evaluates sensor snapshots and produces alert records when thresholds
// are crossed. Implements de-duplication and cooldown to prevent spam.
// =============================================================================

import type { AlertRecord, AlertLevel, SensorSnapshot, SensorId } from "./types"
import { SENSOR_REGISTRY } from "./constants"

/** Minimum seconds between alerts of the same level for the same sensor */
const ALERT_COOLDOWN_MS = 60_000 // 1 minute

/** Tracks the last alert timestamp per sensor+level to enforce cooldown */
const lastAlertTime: Record<string, number> = {}

function cooldownKey(sensorId: SensorId, level: AlertLevel): string {
  return `${sensorId}:${level}`
}

function isOnCooldown(sensorId: SensorId, level: AlertLevel): boolean {
  const key = cooldownKey(sensorId, level)
  const last = lastAlertTime[key]
  if (!last) return false
  return Date.now() - last < ALERT_COOLDOWN_MS
}

function markAlerted(sensorId: SensorId, level: AlertLevel): void {
  lastAlertTime[cooldownKey(sensorId, level)] = Date.now()
}

let alertCounter = 0

function generateId(): string {
  alertCounter++
  return `alert_${Date.now()}_${alertCounter}`
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates a sensor snapshot and returns new AlertRecords for any
 * sensors that have crossed warning/critical thresholds.
 *
 * Rules:
 * - Only fires if level is warning or critical (no spam for normal)
 * - Respects cooldown period per sensor+level
 * - Critical alerts are flagged as persistent (survive reload)
 * - Each alert captures the full sensor snapshot at that moment
 */
export function evaluateSnapshot(snapshot: SensorSnapshot): AlertRecord[] {
  const newAlerts: AlertRecord[] = []

  const sensorEntries: Array<{
    sensorId: SensorId
    reading: typeof snapshot.soilMoisture
  }> = [
      { sensorId: "capacitive_soil_moisture", reading: snapshot.soilMoisture },
      { sensorId: "ultrasonic_water_level", reading: snapshot.waterLevel },
      { sensorId: "humidity_dht22", reading: snapshot.humidity },
    ]

  const snapshotValues = {
    soilMoisture: snapshot.soilMoisture.effectiveValue,
    waterLevel: snapshot.waterLevel.effectiveValue,
    humidity: snapshot.humidity.effectiveValue,
  }

  // 1. Evaluate Sensor Readings
  for (const { sensorId, reading } of sensorEntries) {
    if (reading.status === "normal") continue
    if (isOnCooldown(sensorId, reading.status)) continue

    const meta = SENSOR_REGISTRY[sensorId]
    const isCritical = reading.status === "critical"

    const alert: AlertRecord = {
      id: generateId(),
      level: reading.status,
      title: isCritical
        ? `🚨 CRITICAL: ${meta.shortLabel}`
        : `⚠️ WARNING: ${meta.shortLabel}`,
      message: buildAlertMessage(sensorId, reading.effectiveValue, reading.status, reading.isValid),
      triggeredBy: [sensorId],
      sensorSnapshot: snapshotValues,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      persistent: isCritical,
    }

    newAlerts.push(alert)
    markAlerted(sensorId, reading.status)
  }

  // 2. Evaluate Rainfall (mm/hr rate)
  // Warning: > 7.5mm (Moderate), Critical: > 30mm (Heavy)
  const rainLevel: AlertLevel = snapshot.rainfall > 30 ? "critical" : snapshot.rainfall > 7.5 ? "warning" : "normal"
  if (rainLevel !== "normal" && !isOnCooldown("rain_gauge", rainLevel)) {
    newAlerts.push({
      id: generateId(),
      level: rainLevel,
      title: rainLevel === "critical" ? "🚨 HEAVY RAINFALL ALERT" : "⚠️ MODERATE RAINFALL",
      message: rainLevel === "critical"
        ? `Intense rainfall detected: ${snapshot.rainfall.toFixed(1)} mm/hr. Flash flood risk high.`
        : `Moderate rainfall detected: ${snapshot.rainfall.toFixed(1)} mm/hr. Monitor water levels.`,
      triggeredBy: ["rain_gauge"],
      sensorSnapshot: snapshotValues,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      persistent: rainLevel === "critical",
    })
    markAlerted("rain_gauge", rainLevel)
  }

  // 3. Evaluate Risk Factor
  // Warning: > 50%, Critical: > 80%
  const riskLevel: AlertLevel = snapshot.risk > 0.8 ? "critical" : snapshot.risk > 0.5 ? "warning" : "normal"
  if (riskLevel !== "normal" && !isOnCooldown("risk_engine", riskLevel)) {
    newAlerts.push({
      id: generateId(),
      level: riskLevel,
      title: riskLevel === "critical" ? "🚨 CRITICAL FLOOD RISK" : "⚠️ ELEVATED FLOOD RISK",
      message: riskLevel === "critical"
        ? `Composite risk score is CRITICAL (${(snapshot.risk * 100).toFixed(1)}%). Immediate action required.`
        : `Composite risk score is ELEVATED (${(snapshot.risk * 100).toFixed(1)}%). Preparedness advised.`,
      triggeredBy: ["risk_engine"],
      sensorSnapshot: snapshotValues,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      persistent: riskLevel === "critical",
    })
    markAlerted("risk_engine", riskLevel)
  }

  return newAlerts
}

function buildAlertMessage(
  sensorId: SensorId,
  value: number,
  level: AlertLevel,
  isValid: boolean
): string {
  const meta = SENSOR_REGISTRY[sensorId]
  const validityNote = isValid ? "" : " (using fallback – sensor may be malfunctioning)"

  switch (sensorId) {
    case "ultrasonic_water_level":
      return level === "critical"
        ? `Water level at ${value.toFixed(2)}m – approaching dike crest (3m). ` +
        `Immediate flood risk. Evaluate evacuation.${validityNote}`
        : `Water level rising to ${value.toFixed(2)}m – above normal baseline. ` +
        `Monitor closely.${validityNote}`

    case "capacitive_soil_moisture":
      return level === "critical"
        ? `Dike soil saturation at ${value.toFixed(1)}% – structural integrity at risk. ` +
        `Possible seepage or breach developing.${validityNote}`
        : `Dike soil moisture at ${value.toFixed(1)}% – elevated saturation detected. ` +
        `Inspect for seepage.${validityNote}`

    case "humidity_dht22":
      return level === "critical"
        ? `Ambient humidity at ${value.toFixed(1)}% – heavy rainfall imminent or ongoing. ` +
        `Expect rapid water level rise.${validityNote}`
        : `Ambient humidity at ${value.toFixed(1)}% – rainfall likely within 1 hour. ` +
        `Prepare for potential flooding.${validityNote}`

    default:
      return `${meta.shortLabel} at ${value.toFixed(2)} ${meta.unit} – ${level} level${validityNote}`
  }
}

/**
 * Checks if any reading is invalid and returns sensor-offline alerts.
 * These are separate from threshold alerts.
 */
export function evaluateSensorHealth(snapshot: SensorSnapshot): AlertRecord[] {
  const alerts: AlertRecord[] = []
  const readings = [
    snapshot.soilMoisture,
    snapshot.waterLevel,
    snapshot.humidity,
  ]

  const snapshotValues = {
    soilMoisture: snapshot.soilMoisture.effectiveValue,
    waterLevel: snapshot.waterLevel.effectiveValue,
    humidity: snapshot.humidity.effectiveValue,
  }

  for (const reading of readings) {
    if (!reading.isValid && !isOnCooldown(reading.sensorId, "warning")) {
      const meta = SENSOR_REGISTRY[reading.sensorId]
      alerts.push({
        id: generateId(),
        level: "warning",
        title: `⚙️ Sensor Issue: ${meta.shortLabel}`,
        message: `${meta.label} reported invalid data: ${reading.invalidReason || "unknown"}. ` +
          `Using fallback value (${reading.effectiveValue} ${meta.unit}). ` +
          `Check wiring and sensor placement.`,
        triggeredBy: [reading.sensorId],
        sensorSnapshot: snapshotValues,
        timestamp: new Date().toISOString(),
        acknowledged: false,
        persistent: false,
      })
      markAlerted(reading.sensorId, "warning")
    }
  }

  return alerts
}
