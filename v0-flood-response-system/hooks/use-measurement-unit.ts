"use client"

import { useState, useEffect, useCallback } from "react"
import type { MeasurementUnit } from "@/lib/types"
import { STORAGE_KEYS } from "@/lib/constants"
import { loadString, saveString } from "@/lib/storage"

/**
 * Hook to manage the user's measurement unit preference.
 * Persists to localStorage and provides a toggle function.
 */
export function useMeasurementUnit() {
  const [unit, setUnit] = useState<MeasurementUnit>("metric")

  useEffect(() => {
    const stored = loadString(STORAGE_KEYS.UNIT_PREFERENCE)
    if (stored === "imperial" || stored === "metric") {
      setUnit(stored)
    }
  }, [])

  const toggleUnit = useCallback(() => {
    setUnit((prev) => {
      const next: MeasurementUnit = prev === "metric" ? "imperial" : "metric"
      saveString(STORAGE_KEYS.UNIT_PREFERENCE, next)
      return next
    })
  }, [])

  const setUnitPreference = useCallback((newUnit: MeasurementUnit) => {
    setUnit(newUnit)
    saveString(STORAGE_KEYS.UNIT_PREFERENCE, newUnit)
  }, [])

  return { unit, toggleUnit, setUnitPreference }
}
