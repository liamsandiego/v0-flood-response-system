"use client"

// =============================================================================
// RapidRelay – useMapLayers hook
//
// Manages the MapLayerConfig state and exposes fine-grained setters
// (MapLayerActions) for the controls panel / dashboard to call.
//
// Keeps layer preferences in localStorage so they survive page reloads.
// =============================================================================

import { useState, useCallback, useRef, useEffect } from "react"
import type {
  MapLayerConfig,
  MapLayerActions,
  BaseMapStyle,
  HimawariLayerState,
  MapOverlays,
} from "@/lib/map-types"
import { defaultMapLayerConfig } from "@/lib/map-types"

const STORAGE_KEY = "rapidrelay_map_layers"
// Bump this when MapLayerConfig shape changes — clears stale localStorage automatically
const SCHEMA_VERSION = "v3"

/** Valid Mapbox base map keys */
const VALID_BASE_MAPS: BaseMapStyle[] = ["dark", "satellite", "streets", "outdoors"]

function loadFromStorage(): MapLayerConfig | null {
  if (typeof window === "undefined") return null
  try {
    // Check schema version — if missing or old, blow away stale data and start fresh
    const savedVersion = localStorage.getItem(`${STORAGE_KEY}_version`)
    if (savedVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(`${STORAGE_KEY}_version`, SCHEMA_VERSION)
      return null
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MapLayerConfig>
    const defaults = defaultMapLayerConfig()
    // Validate baseMap — old keys like "esri-satellite" are invalid
    const baseMap = VALID_BASE_MAPS.includes(parsed.baseMap as BaseMapStyle)
      ? (parsed.baseMap as BaseMapStyle)
      : defaults.baseMap
    // Deep-merge with defaults so new fields are always present
    return {
      ...defaults,
      ...parsed,
      baseMap,
      himawari: { ...defaults.himawari, ...parsed.himawari },
      overlays: { ...defaults.overlays, ...parsed.overlays },
    }
  } catch {
    return null
  }
}

function saveToStorage(config: MapLayerConfig) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    localStorage.setItem(`${STORAGE_KEY}_version`, SCHEMA_VERSION)
  } catch {
    // storage full — silently ignore
  }
}

export function useMapLayers() {
  const [config, setConfig] = useState<MapLayerConfig>(() => {
    return loadFromStorage() ?? defaultMapLayerConfig()
  })

  // Persist on change — debounced to avoid thrashing during animation
  const configRef = useRef(config)
  configRef.current = config
  useEffect(() => {
    const timer = setTimeout(() => saveToStorage(config), 2000)
    return () => clearTimeout(timer)
  }, [config])

  // --- Actions ---------------------------------------------------------------

  const setBaseMap = useCallback((style: BaseMapStyle) => {
    setConfig((prev) => ({ ...prev, baseMap: style }))
  }, [])

  const setHimawari = useCallback((patch: Partial<HimawariLayerState>) => {
    setConfig((prev) => ({
      ...prev,
      himawari: { ...prev.himawari, ...patch },
    }))
  }, [])



  const toggleFloodZones = useCallback(() => {
    setConfig((prev) => ({ ...prev, showFloodZones: !prev.showFloodZones }))
  }, [])

  const toggleSensorMarkers = useCallback(() => {
    setConfig((prev) => ({ ...prev, showSensorMarkers: !prev.showSensorMarkers }))
  }, [])

  const setOverlays = useCallback((patch: Partial<MapOverlays>) => {
    setConfig((prev) => ({
      ...prev,
      overlays: { ...prev.overlays, ...patch },
    }))
  }, [])

  const actions: MapLayerActions = {
    setBaseMap,
    setHimawari,
    setOverlays,
    toggleFloodZones,
    toggleSensorMarkers,
  }

  return { layers: config, actions }
}
