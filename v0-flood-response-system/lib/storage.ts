// =============================================================================
// RapidRelay – Persistent Storage Manager
// Handles localStorage with overflow protection, serialization, and recovery.
// =============================================================================

import type { AlertRecord } from "./types"
import { STORAGE_KEYS, MAX_ALERT_RECORDS, ALERT_HISTORY_RETENTION_MS } from "./constants"

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    console.error(`[Storage] Failed to read key "${key}":`, e)
    return null
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    // Likely QuotaExceededError
    console.error(`[Storage] Failed to write key "${key}":`, e)
    // Attempt emergency cleanup
    emergencyCleanup()
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      console.error(`[Storage] Write failed even after cleanup for "${key}"`)
      return false
    }
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Silently fail – removal should never block
  }
}

/**
 * Emergency cleanup: removes oldest alert records and non-critical data
 * to free storage space. Called automatically when writes fail.
 */
function emergencyCleanup(): void {
  console.warn("[Storage] Running emergency cleanup")
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ALERTS)
    if (raw) {
      const alerts: AlertRecord[] = JSON.parse(raw)
      // Keep only the latest 50 critical + last 50 others
      const critical = alerts.filter((a) => a.level === "critical").slice(0, 50)
      const others = alerts.filter((a) => a.level !== "critical").slice(0, 50)
      localStorage.setItem(STORAGE_KEYS.ALERTS, JSON.stringify([...critical, ...others]))
    }
  } catch {
    // If even cleanup fails, nuke alert history
    safeRemoveItem(STORAGE_KEYS.ALERTS)
  }
}

// ---------------------------------------------------------------------------
// Alert Storage
// ---------------------------------------------------------------------------

export function loadAlerts(): AlertRecord[] {
  const raw = safeGetItem(STORAGE_KEYS.ALERTS)
  if (!raw) return []

  try {
    const alerts: AlertRecord[] = JSON.parse(raw)

    // Prune expired non-critical alerts
    const cutoff = Date.now() - ALERT_HISTORY_RETENTION_MS
    const pruned = alerts.filter((a) => {
      if (a.persistent) return true // critical alerts survive
      return new Date(a.timestamp).getTime() > cutoff
    })

    // If we pruned anything, persist the cleaned list
    if (pruned.length !== alerts.length) {
      safeSetItem(STORAGE_KEYS.ALERTS, JSON.stringify(pruned))
    }

    return pruned
  } catch (e) {
    console.error("[Storage] Corrupt alert data, resetting:", e)
    safeRemoveItem(STORAGE_KEYS.ALERTS)
    return []
  }
}

export function saveAlerts(alerts: AlertRecord[]): boolean {
  // Enforce cap
  const capped = alerts.slice(0, MAX_ALERT_RECORDS)
  return safeSetItem(STORAGE_KEYS.ALERTS, JSON.stringify(capped))
}

export function appendAlert(alert: AlertRecord): AlertRecord[] {
  const existing = loadAlerts()
  const updated = [alert, ...existing].slice(0, MAX_ALERT_RECORDS)
  saveAlerts(updated)
  return updated
}

// ---------------------------------------------------------------------------
// Simple key-value helpers
// ---------------------------------------------------------------------------

export function loadString(key: string): string | null {
  return safeGetItem(key)
}

export function saveString(key: string, value: string): boolean {
  return safeSetItem(key, value)
}

export function removeKey(key: string): void {
  safeRemoveItem(key)
}

// ---------------------------------------------------------------------------
// Storage Health
// ---------------------------------------------------------------------------

/**
 * Estimates localStorage usage as a percentage.
 * Most browsers allow ~5 MB per origin.
 */
export function getStorageUsagePercent(): number {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) {
        total += (localStorage.getItem(key) || "").length
      }
    }
    // Assume 5 MB limit (5 * 1024 * 1024 characters in UTF-16 ≈ 2.5M chars)
    const maxChars = 2_500_000
    return Math.min(100, (total / maxChars) * 100)
  } catch {
    return -1 // unknown
  }
}
