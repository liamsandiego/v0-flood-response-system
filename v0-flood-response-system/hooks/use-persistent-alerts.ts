"use client"

import { useState, useEffect, useCallback } from "react"
import type { AlertRecord } from "@/lib/types"
import { loadAlerts, saveAlerts, appendAlert as storageAppend } from "@/lib/storage"

/**
 * Hook for persistent alert history.
 * Loads from localStorage on mount, auto-persists on change.
 * Critical alerts survive reload by design.
 */
export function usePersistentAlerts() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  // Load on mount
  useEffect(() => {
    const stored = loadAlerts()
    setAlerts(stored)
    setLoaded(true)
  }, [])

  const addAlert = useCallback((alert: AlertRecord) => {
    setAlerts((prev) => {
      const updated = [alert, ...prev]
      saveAlerts(updated)
      return updated
    })
  }, [])

  const addAlerts = useCallback((newAlerts: AlertRecord[]) => {
    if (newAlerts.length === 0) return
    setAlerts((prev) => {
      const updated = [...newAlerts, ...prev]
      saveAlerts(updated)
      return updated
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
  }, [])

  const clearNonPersistent = useCallback(() => {
    setAlerts((prev) => {
      const kept = prev.filter((a) => a.persistent && !a.acknowledged)
      saveAlerts(kept)
      return kept
    })
  }, [])

  const clearAll = useCallback(() => {
    setAlerts([])
    saveAlerts([])
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
