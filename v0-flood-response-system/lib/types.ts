// =============================================================================
// RapidRelay – PAGASA Obando, Bulacan · Flood Response System
// Core Type Definitions
// =============================================================================

/** Severity classification for all alerts and sensor statuses */
export type AlertLevel = "normal" | "warning" | "critical"

/** Measurement unit preference */
export type MeasurementUnit = "metric" | "imperial"

// ---------------------------------------------------------------------------
// Sensor Identifiers & Roles
// ---------------------------------------------------------------------------

/**
 * Each physical sensor has a unique, human-readable identifier.
 * These are the ONLY sensors deployed at the PAGASA–Obando dike station.
 */
export type SensorId =
  | "capacitive_soil_moisture"
  | "ultrasonic_water_level"
  | "humidity_dht22"
  | "rain_gauge"
  | "risk_engine"
  | "flood_mapper"

/** Describes the physical role a sensor plays in the monitoring station */
export interface SensorMeta {
  id: SensorId
  label: string
  shortLabel: string
  description: string
  unit: string
  imperialUnit: string
  /** Acceptable range – readings outside this are treated as malfunction */
  validRange: { min: number; max: number }
  /** Thresholds that map readings → AlertLevel */
  thresholds: { warning: number; critical: number }
  /** The last-known-good fallback value used when a reading fails validation */
  fallbackValue: number
  /** Geographic placement relative to the monitoring station */
  placement: string
}

// ---------------------------------------------------------------------------
// Sensor Readings
// ---------------------------------------------------------------------------

/** A single timestamped reading from one sensor */
export interface SensorReading {
  sensorId: SensorId
  value: number
  /** Whether this reading passed sanity checks */
  isValid: boolean
  /** If invalid, the reason it was rejected */
  invalidReason?: string
  /** The value actually used (may be fallback if isValid===false) */
  effectiveValue: number
  timestamp: Date
  status: AlertLevel
}

/** Aggregated snapshot of all three sensors at a single point in time */
export interface SensorSnapshot {
  soilMoisture: SensorReading
  waterLevel: SensorReading
  humidity: SensorReading
  // New metrics from Excel data
  rainfall: number
  floodExtent: number
  wetnessTrend: number
  risk: number
  overallStatus: AlertLevel
  timestamp: Date
}

// ---------------------------------------------------------------------------
// Alert / History Records
// ---------------------------------------------------------------------------

export interface AlertRecord {
  id: string
  level: AlertLevel
  title: string
  message: string
  /** Which sensor(s) triggered the alert */
  triggeredBy: SensorId[]
  /** Full sensor snapshot at the moment the alert was created */
  sensorSnapshot: {
    soilMoisture: number
    waterLevel: number
    humidity: number
  }
  timestamp: string // ISO string for serialization
  acknowledged: boolean
  /** Critical alerts persist across reloads */
  persistent: boolean
}

/** Broadcast history entry (alert controls) */
export interface BroadcastRecord {
  id: string
  time: string
  message: string
  channels: string
  alertLevel: AlertLevel
}

// ---------------------------------------------------------------------------
// System Health
// ---------------------------------------------------------------------------

export type SystemHealthStatus = "healthy" | "degraded" | "offline"

export interface SystemHealth {
  status: SystemHealthStatus
  sensors: Record<SensorId, {
    online: boolean
    lastValidReading: Date | null
    consecutiveFailures: number
  }>
  networkOnline: boolean
  storageUsagePercent: number
  lastRecoveryAttempt: Date | null
  uptime: number // ms since last initialization
}

// ---------------------------------------------------------------------------
// User / Auth
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "operator" | "viewer"

export interface User {
  id: string
  email: string
  username: string
  role: UserRole
  name: string
}

// ---------------------------------------------------------------------------
// Legacy compat – SensorData (used by components during migration)
// ---------------------------------------------------------------------------

export interface SensorData {
  id: string
  name: string
  waterLevel: number
  rainfall: number
  status: AlertLevel
  lat: number
  lng: number
  lastUpdate: Date
}
