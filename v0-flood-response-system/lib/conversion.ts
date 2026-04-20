// =============================================================================
// RapidRelay – Measurement Unit Conversion
// =============================================================================

import type { MeasurementUnit, SensorId, TemperatureUnit } from "./types"
import { METERS_TO_FEET, SENSOR_REGISTRY } from "./constants"

export interface UnitPreferences {
  distance: MeasurementUnit
  temperature: TemperatureUnit
}

type UnitInput = MeasurementUnit | UnitPreferences

function resolveStoredTemperatureUnit(): TemperatureUnit {
  if (typeof window === "undefined") return "celsius"
  try {
    const saved = window.localStorage.getItem("rapidrelay_temperature_unit")
    if (saved === "celsius" || saved === "fahrenheit") return saved
  } catch {
    // Ignore storage access issues and fall back to Celsius.
  }
  return "celsius"
}

function resolveUnitPreferences(targetUnit: UnitInput): UnitPreferences {
  if (typeof targetUnit === "string") {
    return {
      distance: targetUnit,
      temperature: resolveStoredTemperatureUnit(),
    }
  }
  return targetUnit
}

/**
 * Converts a sensor value from metric to the target unit system.
 * Water level: meters to feet
 * Temperature: Celsius to Fahrenheit
 * Pressure: hPa to inHg
 * Soil moisture, humidity: already percentages (unit-agnostic)
 */
export function convertValue(
  sensorId: SensorId,
  valueInMetric: number,
  targetUnit: UnitInput
): number {
  const { distance, temperature } = resolveUnitPreferences(targetUnit)

  // Temperature: Celsius or Fahrenheit
  if (sensorId === "temperature_bme680") {
    return temperature === "fahrenheit" ? (valueInMetric * 9) / 5 + 32 : valueInMetric
  }

  if (distance === "metric") return valueInMetric

  // Water level: meters to feet
  if (sensorId === "ultrasonic_water_level") {
    return valueInMetric * METERS_TO_FEET
  }

  // Pressure: hPa to inHg (1 hPa = 0.02953 inHg)
  if (sensorId === "pressure_bme680") {
    return valueInMetric * 0.02953
  }

  // Percentages don't convert
  return valueInMetric
}

/**
 * Returns the display unit string for a sensor in the given unit system.
 */
export function getDisplayUnit(sensorId: SensorId, unit: UnitInput): string {
  const { distance, temperature } = resolveUnitPreferences(unit)
  const meta = SENSOR_REGISTRY[sensorId]

  if (sensorId === "temperature_bme680") {
    return temperature === "fahrenheit" ? meta.imperialUnit : meta.unit
  }

  return distance === "metric" ? meta.unit : meta.imperialUnit
}

/**
 * Formats a sensor value with its unit for display.
 * Handles appropriate decimal precision per sensor type.
 */
export function formatSensorValue(
  sensorId: SensorId,
  valueInMetric: number,
  unit: UnitInput
): string {
  const converted = convertValue(sensorId, valueInMetric, unit)
  const displayUnit = getDisplayUnit(sensorId, unit)

  if (sensorId === "ultrasonic_water_level") {
    return `${converted.toFixed(2)} ${displayUnit}`
  }

  // Temperature: 1 decimal place
  if (sensorId === "temperature_bme680") {
    return `${converted.toFixed(1)} ${displayUnit}`
  }

  // Pressure: 0 decimal places (hPa/inHg)
  if (sensorId === "pressure_bme680") {
    return `${converted.toFixed(0)} ${displayUnit}`
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
