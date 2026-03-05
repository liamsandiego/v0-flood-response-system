// =============================================================================
// RapidRelay – Measurement Unit Conversion
// =============================================================================

import type { MeasurementUnit, SensorId } from "./types"
import { METERS_TO_FEET, SENSOR_REGISTRY } from "./constants"

/**
 * Converts a sensor value from metric to the target unit system.
 * Only the ultrasonic water level sensor uses meters; soil moisture
 * and humidity are already percentages (unit-agnostic).
 */
export function convertValue(
  sensorId: SensorId,
  valueInMetric: number,
  targetUnit: MeasurementUnit
): number {
  if (targetUnit === "metric") return valueInMetric

  // Only water level is distance-based
  if (sensorId === "ultrasonic_water_level") {
    return valueInMetric * METERS_TO_FEET
  }

  // Percentages don't convert
  return valueInMetric
}

/**
 * Returns the display unit string for a sensor in the given unit system.
 */
export function getDisplayUnit(sensorId: SensorId, unit: MeasurementUnit): string {
  const meta = SENSOR_REGISTRY[sensorId]
  return unit === "metric" ? meta.unit : meta.imperialUnit
}

/**
 * Formats a sensor value with its unit for display.
 * Handles appropriate decimal precision per sensor type.
 */
export function formatSensorValue(
  sensorId: SensorId,
  valueInMetric: number,
  unit: MeasurementUnit
): string {
  const converted = convertValue(sensorId, valueInMetric, unit)
  const displayUnit = getDisplayUnit(sensorId, unit)

  if (sensorId === "ultrasonic_water_level") {
    return `${converted.toFixed(2)} ${displayUnit}`
  }

  // Percentages: 1 decimal place
  return `${converted.toFixed(1)} ${displayUnit}`
}

/**
 * Converts thresholds to display units for settings / UI.
 */
export function convertThreshold(
  sensorId: SensorId,
  thresholdMetric: number,
  targetUnit: MeasurementUnit
): number {
  return convertValue(sensorId, thresholdMetric, targetUnit)
}
