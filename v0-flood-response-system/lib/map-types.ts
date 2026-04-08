// =============================================================================
// RapidRelay – Map Layer Types (v2)
// Types for the Mapbox GL globe + overlays.
// =============================================================================

/** Available base map styles (Mapbox GL JS compatible) */
export type BaseMapStyle =
  | "dark"
  | "satellite"
  | "streets"
  | "outdoors"

/** State of a single toggleable overlay layer */
export interface OverlayLayerState {
  enabled: boolean
  opacity: number // 0–1
}

/** Himawari-specific state */
export interface HimawariLayerState extends OverlayLayerState {
  time: string            // ISO 8601 timestamp (YYYY-MM-DDTHH:MM:SSZ) or YYYY-MM-DD
  product: "infrared" | "visible"
  animating: boolean
  animationSpeed: number  // ms per frame
}

/** Map overlay toggles inspired by Zoom Earth */
export interface MapOverlays {
  /** Map Labels (place names overlay on satellite) */
  mapLabels: boolean
  /** Country/state border lines */
  borderLines: boolean
  /** Day/night terminator line */
  nightBoundary: boolean
  /** Crosshair at map center */
  crosshair: boolean
}

/** Complete map layer configuration */
export interface MapLayerConfig {
  baseMap: BaseMapStyle
  himawari: HimawariLayerState
  overlays: MapOverlays
  showFloodZones: boolean
  showSensorMarkers: boolean
}

/** Callbacks for updating layer state */
export interface MapLayerActions {
  setBaseMap: (style: BaseMapStyle) => void
  setHimawari: (patch: Partial<HimawariLayerState>) => void
  setOverlays: (patch: Partial<MapOverlays>) => void
  toggleFloodZones: () => void
  toggleSensorMarkers: () => void
}

/** Default layer config */
export function defaultMapLayerConfig(): MapLayerConfig {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
  const himawariTime = fourHoursAgo.toISOString().slice(0, 10)

  return {
    baseMap: "dark",
    himawari: {
      enabled: false,
      opacity: 0.7,
      time: himawariTime,
      product: "infrared",
      animating: false,
      animationSpeed: 1000,
    },
    overlays: {
      mapLabels: true,
      borderLines: true,
      nightBoundary: false,
      crosshair: false,
    },
    showFloodZones: true,
    showSensorMarkers: true,
  }
}
