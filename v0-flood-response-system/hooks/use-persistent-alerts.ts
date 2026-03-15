"use client"

import { useState, useEffect, useCallback } from "react"
import type { AlertRecord } from "@/lib/types"
import { loadAlerts, saveAlerts } from "@/lib/storage"
import { supabase } from "@/lib/supabase"

/**
 * Hook for persistent alert history.
 * Dual-write: localStorage (offline PWA) + Supabase (cloud persistence).
 * Loads from Supabase on mount with localStorage fallback.
 */
export function usePersistentAlerts() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  // Load from Supabase on mount, fall back to localStorage
  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("alerts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200)

        if (!error && data && data.length > 0) {
          const mapped: AlertRecord[] = data.map((row) => ({
            id: String(row.id),
            level: row.alert_level as AlertRecord["level"],
            title: row.title,
            message: row.message,
            triggeredBy: (row.triggered_by ?? []) as AlertRecord["triggeredBy"],
            sensorSnapshot: row.sensor_snapshot ?? { soilMoisture: 0, waterLevel: 0, humidity: 0 },
            timestamp: row.created_at,
            acknowledged: row.acknowledged ?? false,
            persistent: row.persistent ?? false,
          }))
          setAlerts(mapped)
          saveAlerts(mapped)
        } else {
          setAlerts(loadAlerts())
        }
      } catch {
        setAlerts(loadAlerts())
      }
      setLoaded(true)
    }
    load()
  }, [])

  const addAlert = useCallback((alert: AlertRecord) => {
    setAlerts((prev) => {
      const updated = [alert, ...prev]
      saveAlerts(updated)
      return updated
    })
    // Fire-and-forget write to Supabase
    supabase.from("alerts").insert({
      alert_level: alert.level,
      title: alert.title,
      message: alert.message,
      triggered_by: alert.triggeredBy,
      sensor_snapshot: alert.sensorSnapshot,
      persistent: alert.persistent,
      source: "dashboard",
    }).then(({ error }) => {
      if (error) console.warn("[Supabase] Failed to persist alert:", error.message)
    })
  }, [])

  const addAlerts = useCallback((newAlerts: AlertRecord[]) => {
    if (newAlerts.length === 0) return
    setAlerts((prev) => {
      const updated = [...newAlerts, ...prev]
      saveAlerts(updated)
      return updated
    })
    // Batch insert to Supabase
    const rows = newAlerts.map((a) => ({
      alert_level: a.level,
      title: a.title,
      message: a.message,
      triggered_by: a.triggeredBy,
      sensor_snapshot: a.sensorSnapshot,
      persistent: a.persistent,
      source: "dashboard",
    }))
    supabase.from("alerts").insert(rows).then(({ error }) => {
      if (error) console.warn("[Supabase] Failed to persist alerts:", error.message)
    })
  }, [])

  const acknowledgeAlert = useCallback((alertId: string) => {
    setAlerts((prev) => {
      const updated = prev.map((a) =>
        a.id === alertId ? { ...a, acknowledged: true } : a
      )
      saveAlerts(updated)
      return updated
    })
    // Update in Supabase (alertId may be numeric from Supabase)
    const numId = parseInt(alertId, 10)
    if (!isNaN(numId)) {
      supabase.from("alerts")
        .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
        .eq("id", numId)
        .then(({ error }) => {
          if (error) console.warn("[Supabase] Failed to acknowledge alert:", error.message)
        })
    }
  }, [])

  const clearNonPersistent = useCallback(() => {
    setAlerts((prev) => {
      const kept = prev.filter((a) => a.persistent && !a.acknowledged)
      saveAlerts(kept)
      return kept
    })
    // Also remove non-persistent acknowledged alerts from Supabase
    supabase.from("alerts").delete()
      .or("persistent.eq.false,acknowledged.eq.true")
      .then(({ error }) => {
        if (error) console.warn("[Supabase] Failed to clear non-persistent alerts:", error.message)
      })
  }, [])

  const clearAll = useCallback(() => {
    setAlerts([])
    saveAlerts([])
    // Delete all from Supabase
    supabase.from("alerts").delete().gte("id", 0).then(({ error }) => {
      if (error) console.warn("[Supabase] Failed to clear alerts:", error.message)
    })
  }, [])

  return {
    alerts,
    loaded,
    addAlert,
    addAlerts,
    acknowledgeAlert,
    clearNonPersistent,
    clearAll,
  }
}
