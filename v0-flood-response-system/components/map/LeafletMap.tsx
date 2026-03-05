"use client"

// =============================================================================
// RapidRelay – Smooth Leaflet Map
//
// Why Leaflet instead of MapLibre?
//   The project already uses Leaflet 1.9.4. Rather than a risky migration,
//   we tune Leaflet's built-in options (fractional zoom, inertia, canvas
//   renderer) and add a smooth wheel-zoom handler to reach Windy-like UX.
//
// Smooth-zoom approach:
//   Leaflet's native `scrollWheelZoom` jumps by integer levels. We disable
//   it and implement our own handler that calls `map.setZoom()` with small
//   fractional deltas + a `flyTo`-style animation. No extra npm plugin needed.
// =============================================================================

import { useEffect, useRef, useCallback } from "react"
import type { SensorSnapshot, MeasurementUnit } from "@/lib/types"
import type { MapLayerConfig } from "@/lib/map-types"
import { DEPLOYMENT, SENSOR_REGISTRY, ALL_SENSOR_IDS } from "@/lib/constants"
import { formatSensorValue } from "@/lib/conversion"

// ---------------------------------------------------------------------------
// Base map tile URLs
// ---------------------------------------------------------------------------
const BASE_MAPS: Record<string, { url: string; attribution: string; maxZoom: number }> = {
  "esri-satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar, USDA, USGS, AeroGRID, IGN",
    maxZoom: 19,
  },
  "esri-dark": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Esri, DeLorme, NAVTEQ",
    maxZoom: 16,
  },
  "carto-dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
}

// ---------------------------------------------------------------------------
// Sensor positions on map (same as original flood-map.tsx)
// ---------------------------------------------------------------------------
const SENSOR_POSITIONS: Record<string, [number, number]> = {
  ultrasonic_water_level: [14.7097, 120.9355],
  capacitive_soil_moisture: [14.7091, 120.9360],
  humidity_dht22: [14.7094, 120.9365],
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface LeafletMapProps {
  snapshot: SensorSnapshot | null
  unit: MeasurementUnit
  layers: MapLayerConfig
  /** Pre-built RainViewer tile URL template for current frame (from useRainViewer) */
  rainViewerTileUrl: string | null
}

export function LeafletMap({ snapshot, unit, layers, rainViewerTileUrl }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  // Layer group refs – we keep these stable and just clear/redraw on updates
  const baseLayerRef = useRef<any>(null)
  const himawariLayerRef = useRef<any>(null)
  const rainViewerLayerRef = useRef<any>(null)
  const zoneLayerGroupRef = useRef<any>(null)
  const markerLayerGroupRef = useRef<any>(null)

  // Track current base map key so we only swap tiles when it changes
  const currentBaseKeyRef = useRef<string>("")

  // -------------------------------------------------------------------------
  // One-time map initialisation
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return

    let cancelled = false

    import("leaflet").then((L) => {
      if (cancelled || mapRef.current) return

      // -- Create map with smooth-scroll tuning --------------------------------
      const map = L.map(containerRef.current!, {
        center: [DEPLOYMENT.coordinates.lat, DEPLOYMENT.coordinates.lng],
        zoom: DEPLOYMENT.mapZoom,

        // Fractional zoom – enables 0.1-step zoom levels (Windy-like)
        zoomSnap: 0.1,
        zoomDelta: 0.5,

        // Inertia panning – momentum after releasing drag
        inertia: true,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: Infinity,
        easeLinearity: 0.2,

        // Wheel zoom debounce (native scroll)
        wheelDebounceTime: 80,
        wheelPxPerZoomLevel: 120,

        // Canvas renderer for performance (thousands of points won't lag)
        renderer: L.canvas({ padding: 0.5 }),

        // Zoom/fade animation
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
      })

      mapRef.current = map

      // -- Smooth wheel zoom override -----------------------------------------
      //    Disable native scroll-zoom and attach a requestAnimationFrame-based
      //    handler that applies small fractional zoom increments for butter
      //    smoothness, similar to Windy's feel.
      map.scrollWheelZoom.disable()

      let targetZoom = map.getZoom()
      let animating = false

      const smoothZoom = (e: WheelEvent) => {
        e.preventDefault()
        const delta = -e.deltaY * 0.0012 // sensitivity multiplier
        targetZoom = Math.min(
          Math.max(targetZoom + delta, map.getMinZoom()),
          map.getMaxZoom()
        )

        if (!animating) {
          animating = true
          const step = () => {
            const current = map.getZoom()
            const diff = targetZoom - current
            if (Math.abs(diff) < 0.01) {
              animating = false
              return
            }
            // Ease towards target (lerp)
            const next = current + diff * 0.25
            map.setZoom(next, { animate: false })
            requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }
      }

      containerRef.current!.addEventListener("wheel", smoothZoom, { passive: false })

      // Keep targetZoom in sync if user zooms via buttons / pinch
      map.on("zoomend", () => {
        targetZoom = map.getZoom()
      })

      // -- Layer groups -------------------------------------------------------
      zoneLayerGroupRef.current = L.layerGroup().addTo(map)
      markerLayerGroupRef.current = L.layerGroup().addTo(map)
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, []) // run once

  // -------------------------------------------------------------------------
  // Base map layer – swap only when `layers.baseMap` changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current) return
    if (currentBaseKeyRef.current === layers.baseMap) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      // Remove old base layer
      if (baseLayerRef.current) {
        map.removeLayer(baseLayerRef.current)
      }

      const cfg = BASE_MAPS[layers.baseMap] ?? BASE_MAPS["esri-satellite"]
      baseLayerRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: cfg.maxZoom,
      }).addTo(map)

      // Push base layer to bottom
      baseLayerRef.current.setZIndex(0)
      currentBaseKeyRef.current = layers.baseMap
    })
  }, [layers.baseMap])

  // -------------------------------------------------------------------------
  // Himawari overlay – NASA GIBS WMS
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      // Always remove the old Himawari layer first
      if (himawariLayerRef.current) {
        map.removeLayer(himawariLayerRef.current)
        himawariLayerRef.current = null
      }

      if (!layers.himawari.enabled) return

      const product =
        layers.himawari.product === "visible"
          ? "Himawari_AHI_Band3_Red_Visible"
          : "Himawari_AHI_Band13_Clean_Infrared"

      // NASA GIBS WMS – completely free, no API key required.
      // The TIME dimension expects YYYY-MM-DD format.
      // Himawari data covers East Asia / West Pacific – perfect for the Philippines.
      // Typical delay: 3–5 hours from present.
      himawariLayerRef.current = L.tileLayer.wms(
        "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
        {
          layers: product,
          format: "image/png",
          transparent: true,
          version: "1.3.0",
          // GIBS caps at zoom 8 for Himawari products
          maxZoom: 8,
          opacity: layers.himawari.opacity,
          // TIME dimension – date only (GIBS resolves to best available)
          time: layers.himawari.time,
          attribution: "NASA GIBS / Himawari-9 (JMA)",
        } as any
      ).addTo(map)

      // Keep Himawari above base but below markers
      himawariLayerRef.current.setZIndex(5)
    })
  }, [layers.himawari.enabled, layers.himawari.opacity, layers.himawari.time, layers.himawari.product])

  // -------------------------------------------------------------------------
  // RainViewer radar overlay – XYZ tile layer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      // Always remove the previous RainViewer layer
      if (rainViewerLayerRef.current) {
        map.removeLayer(rainViewerLayerRef.current)
        rainViewerLayerRef.current = null
      }

      if (!layers.rainViewer.enabled || !rainViewerTileUrl) return

      rainViewerLayerRef.current = L.tileLayer(rainViewerTileUrl, {
        tileSize: 256,
        opacity: layers.rainViewer.opacity,
        zIndex: 6, // above Himawari (5), below markers
        attribution: '<a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
      }).addTo(map)
    })
  }, [layers.rainViewer.enabled, layers.rainViewer.opacity, rainViewerTileUrl])

  // -------------------------------------------------------------------------
  // Flood zone polygons
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current || !zoneLayerGroupRef.current) return

    import("leaflet").then((L) => {
      const group = zoneLayerGroupRef.current
      group.clearLayers()

      if (!layers.showFloodZones) return

      DEPLOYMENT.FLOOD_ZONES.forEach((zone) => {
        let fillColor = "#22c55e"
        let opacity = 0.2

        if (snapshot?.overallStatus === "critical") {
          if (zone.id === "zone_a") { fillColor = "#ef4444"; opacity = 0.6 }
          else if (zone.id === "zone_b") { fillColor = "#f97316"; opacity = 0.4 }
          else { fillColor = "#eab308"; opacity = 0.3 }
        } else if (snapshot?.overallStatus === "warning") {
          if (zone.id === "zone_a") { fillColor = "#f97316"; opacity = 0.4 }
          else { fillColor = "#eab308"; opacity = 0.3 }
        }

        L.polygon(zone.coordinates, {
          color: fillColor,
          fillColor,
          fillOpacity: opacity,
          weight: 2,
          dashArray: "5,5",
        })
          .bindPopup(
            `<strong>${zone.name}</strong><br/>` +
            `Status: ${snapshot?.overallStatus === "critical" && zone.id === "zone_a" ? "CRITICAL" : snapshot?.overallStatus?.toUpperCase() ?? "NORMAL"}<br/>` +
            `<small>Monitored Area</small>`
          )
          .addTo(group)
      })
    })
  }, [snapshot?.overallStatus, layers.showFloodZones])

  // -------------------------------------------------------------------------
  // Sensor markers
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapRef.current || !markerLayerGroupRef.current) return

    import("leaflet").then((L) => {
      const group = markerLayerGroupRef.current
      group.clearLayers()

      if (!layers.showSensorMarkers || !snapshot) return

      ALL_SENSOR_IDS.forEach((sensorId) => {
        const meta = SENSOR_REGISTRY[sensorId]
        const reading =
          sensorId === "ultrasonic_water_level" ? snapshot.waterLevel :
            sensorId === "capacitive_soil_moisture" ? snapshot.soilMoisture :
              snapshot.humidity
        const pos = SENSOR_POSITIONS[sensorId]
        if (!pos) return

        const color =
          reading.status === "critical" ? "#ef4444" :
            reading.status === "warning" ? "#f59e0b" :
              "#3b82f6"

        const iconLabel =
          sensorId === "ultrasonic_water_level" ? "W" :
            sensorId === "capacitive_soil_moisture" ? "S" : "H"

        const icon = L.divIcon({
          className: "custom-marker",
          html: `
            <div style="
              background: ${color};
              width: 34px; height: 34px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 10px rgba(0,0,0,0.35);
              display: flex; align-items: center; justify-content: center;
              color: white; font-weight: bold; font-size: 14px;
              transition: transform 0.2s ease;
            ">${iconLabel}</div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        })

        const marker = L.marker(pos, { icon }).addTo(group)

        const validityBadge = reading.isValid
          ? ""
          : `<br/><span style="color: orange; font-weight: bold;">⚠ Using fallback value</span>`

        marker.bindPopup(`
          <div style="font-family: system-ui; padding: 4px; min-width: 200px;">
            <strong>${meta.label}</strong><br/>
            <small style="color: #666;">${meta.placement}</small><br/><br/>
            Value: <strong>${formatSensorValue(sensorId, reading.effectiveValue, unit)}</strong><br/>
            Status: <span style="color: ${color}; font-weight: bold;">${reading.status.toUpperCase()}</span>
            ${validityBadge}<br/>
            <small>Updated: ${reading.timestamp.toLocaleTimeString()}</small>
          </div>
        `)
      })
    })
  }, [snapshot, unit, layers.showSensorMarkers])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      {/* Extra smoothness CSS – anti-aliased tiles, crossfade transitions */}
      <style>{`
        .leaflet-tile-container img {
          transition: opacity 0.3s ease-in-out;
        }
        .leaflet-fade-anim .leaflet-tile,
        .leaflet-fade-anim .leaflet-popup {
          transition: opacity 0.3s ease-in-out;
        }
        .leaflet-container {
          background: #0a0a0a;
        }
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
      <div
        ref={containerRef}
        className="h-[400px] md:h-[550px] w-full rounded-lg border border-border"
        style={{ zIndex: 0 }}
      />
    </>
  )
}
