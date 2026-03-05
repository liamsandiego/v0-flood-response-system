"use client"

// =============================================================================
// RapidRelay – Optimized Leaflet Map (v2)
//
// Performance fixes applied:
//   1. zoomSnap: 1 — integer zoom only (fractional zoom caused tile flicker)
//   2. SVG renderer — lighter than Canvas for our polygon count
//   3. fadeAnimation: false — prevents tile disappear/reappear during zoom
//   4. updateWhenZooming: false — don't load tiles mid-zoom
//   5. updateWhenIdle: true — only fetch tiles when movement stops
//   6. Standard scrollWheelZoom — custom RAF zoom was causing lag
//   7. subdomains for parallel tile loading
//   8. Proper layer cleanup — no memory leaks
//
// Overlay layers managed:
//   - Base map (4 options)
//   - Himawari satellite (NASA GIBS WMS)
//   - RainViewer radar (XYZ tiles)
//   - Map Labels overlay (Stamen/CartoDB labels)
//   - Border Lines (country boundaries)
//   - Night Boundary (day/night terminator)
//   - Crosshair (CSS only, no layer)
//   - Flood zone polygons
//   - Sensor markers
// =============================================================================

import { useEffect, useRef, useState } from "react"
import type { SensorSnapshot, MeasurementUnit } from "@/lib/types"
import type { MapLayerConfig } from "@/lib/map-types"
import { DEPLOYMENT, SENSOR_REGISTRY, ALL_SENSOR_IDS } from "@/lib/constants"
import { formatSensorValue } from "@/lib/conversion"

// ---------------------------------------------------------------------------
// Base map tile URLs — using subdomains for parallel loading
// ---------------------------------------------------------------------------
const BASE_MAPS: Record<string, {
  url: string
  attribution: string
  maxZoom: number
  subdomains?: string
}> = {
  "esri-satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 18,
  },
  "esri-dark": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 16,
  },
  "carto-dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
    subdomains: "abcd",
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a>',
    maxZoom: 19,
    subdomains: "abc",
  },
}

// Label overlay (place names on top of satellite imagery)
const LABELS_URL = "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
// Border lines
const BORDERS_URL = "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"

// Sensor positions
const SENSOR_POSITIONS: Record<string, [number, number]> = {
  ultrasonic_water_level: [14.7097, 120.9355],
  capacitive_soil_moisture: [14.7091, 120.9360],
  humidity_dht22: [14.7094, 120.9365],
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface OptimizedLeafletMapProps {
  snapshot: SensorSnapshot | null
  unit: MeasurementUnit
  layers: MapLayerConfig
  /** Pre-built RainViewer tile URL template for current frame */
  rainViewerTileUrl: string | null
  /** Loading state for RainViewer */
  rainViewerLoading?: boolean
}

export function OptimizedLeafletMap({
  snapshot,
  unit,
  layers,
  rainViewerTileUrl,
  rainViewerLoading,
}: OptimizedLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [mapReady, setMapReady] = useState(false)
  const [tileLoading, setTileLoading] = useState(false)

  // Layer refs — stable across renders, cleared/swapped as needed
  const baseLayerRef = useRef<any>(null)
  const himawariLayerRef = useRef<any>(null)
  const rainViewerLayerRef = useRef<any>(null)
  const labelsLayerRef = useRef<any>(null)
  const bordersLayerRef = useRef<any>(null)
  const nightLayerRef = useRef<any>(null)
  const crosshairGroupRef = useRef<any>(null)
  const sentinelGroupRef = useRef<any>(null)
  const zoneGroupRef = useRef<any>(null)
  const markerGroupRef = useRef<any>(null)
  const currentBaseKeyRef = useRef("")

  // -------------------------------------------------------------------------
  // One-time map init — PERFORMANCE CRITICAL CONFIG
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return
    let cancelled = false

    import("leaflet").then((L) => {
      if (cancelled || mapRef.current) return

      const map = L.map(containerRef.current!, {
        center: [DEPLOYMENT.coordinates.lat, DEPLOYMENT.coordinates.lng],
        zoom: DEPLOYMENT.mapZoom,

        // ── PERFORMANCE: integer zoom only ──
        zoomSnap: 1,
        zoomDelta: 1,

        // ── PERFORMANCE: disable tile fade (prevents flicker) ──
        fadeAnimation: false,
        markerZoomAnimation: false,
        zoomAnimation: true,

        // ── PERFORMANCE: SVG renderer (lighter for <100 shapes) ──
        renderer: L.svg(),

        // ── PERFORMANCE: standard wheel zoom (no custom RAF) ──
        scrollWheelZoom: true,
        wheelDebounceTime: 150,
        wheelPxPerZoomLevel: 120,

        // ── PERFORMANCE: don't load tiles while zooming ──
        // @ts-ignore — Leaflet types don't expose these but they work
        updateWhenZooming: false,
        updateWhenIdle: true,

        // Inertia for smooth panning
        inertia: true,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: 1500,

        // Zoom bounds
        maxZoom: 18,
        minZoom: 5,
      })

      mapRef.current = map

      // Layer groups for flood zones + sensors
      zoneGroupRef.current = L.layerGroup().addTo(map)
      markerGroupRef.current = L.layerGroup().addTo(map)

      // Track tile loading state
      map.on("loading", () => setTileLoading(true))
      map.on("load", () => setTileLoading(false))

      setMapReady(true)
    })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        setMapReady(false)
      }
    }
  }, [])

  // -------------------------------------------------------------------------
  // Base map — only swap when key changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    if (currentBaseKeyRef.current === layers.baseMap) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      const oldLayer = baseLayerRef.current

      const cfg = BASE_MAPS[layers.baseMap] ?? BASE_MAPS["esri-satellite"]
      const newLayer = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: cfg.maxZoom,
        subdomains: cfg.subdomains ?? "",
        tileSize: 256,
        detectRetina: false,
        // @ts-ignore
        updateWhenZooming: false,
        updateWhenIdle: true,
      }).addTo(map)

      newLayer.setZIndex(0)
      baseLayerRef.current = newLayer
      currentBaseKeyRef.current = layers.baseMap

      // Remove old layer AFTER new tiles load (prevents blank gray screen)
      if (oldLayer) {
        const removeOld = () => {
          const m = mapRef.current
          if (m && m.hasLayer(oldLayer)) m.removeLayer(oldLayer)
        }
        newLayer.once("load", removeOld)
        // Fallback: remove after 3s even if load event doesn't fire
        setTimeout(removeOld, 3000)
      }
    })
  }, [mapReady, layers.baseMap])

  // -------------------------------------------------------------------------
  // Himawari overlay — NASA GIBS WMS
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return
      if (himawariLayerRef.current) {
        map.removeLayer(himawariLayerRef.current)
        himawariLayerRef.current = null
      }
      if (!layers.himawari.enabled) return

      const product = layers.himawari.product === "visible"
        ? "Himawari_AHI_Band3_Red_Visible"
        : "Himawari_AHI_Band13_Clean_Infrared"

      himawariLayerRef.current = L.tileLayer.wms(
        "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
        {
          layers: product,
          format: "image/png",
          transparent: true,
          version: "1.3.0",
          maxZoom: 8,
          opacity: layers.himawari.opacity,
          time: layers.himawari.time,
          // @ts-ignore
          tileSize: 256,
          attribution: "NASA GIBS / Himawari-9",
        } as any
      ).addTo(map)

      himawariLayerRef.current.setZIndex(5)
    })
  }, [
    mapReady,
    layers.himawari.enabled,
    layers.himawari.opacity,
    layers.himawari.time,
    layers.himawari.product,
  ])

  // -------------------------------------------------------------------------
  // RainViewer radar — XYZ tiles, properly managed
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      // Always remove previous layer to prevent leaks
      if (rainViewerLayerRef.current) {
        map.removeLayer(rainViewerLayerRef.current)
        rainViewerLayerRef.current = null
      }

      if (!layers.rainViewer.enabled || !rainViewerTileUrl) return

      rainViewerLayerRef.current = L.tileLayer(rainViewerTileUrl, {
        tileSize: 256,
        opacity: layers.rainViewer.opacity,
        detectRetina: false,
        // @ts-ignore
        updateWhenZooming: false,
        updateWhenIdle: true,
        attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>',
      }).addTo(map)

      rainViewerLayerRef.current.setZIndex(6)
    })
  }, [mapReady, layers.rainViewer.enabled, layers.rainViewer.opacity, rainViewerTileUrl])

  // -------------------------------------------------------------------------
  // Map Labels overlay (CartoDB labels-only tiles)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return
      if (labelsLayerRef.current) {
        map.removeLayer(labelsLayerRef.current)
        labelsLayerRef.current = null
      }
      if (!layers.overlays.mapLabels) return

      labelsLayerRef.current = L.tileLayer(LABELS_URL, {
        subdomains: "abcd",
        maxZoom: 19,
        tileSize: 256,
        detectRetina: false,
        pane: "overlayPane",
        attribution: "Labels &copy; CARTO",
      }).addTo(map)

      labelsLayerRef.current.setZIndex(100)
    })
  }, [mapReady, layers.overlays.mapLabels])

  // -------------------------------------------------------------------------
  // Border Lines (simplified — using CartoDB boundaries layer)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return
      if (bordersLayerRef.current) {
        map.removeLayer(bordersLayerRef.current)
        bordersLayerRef.current = null
      }
      if (!layers.overlays.borderLines) return

      // Use a semi-transparent boundary-only tile layer
      bordersLayerRef.current = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          tileSize: 256,
          opacity: 0.15, // very faint — just enough to see borders
          detectRetina: false,
          attribution: "",
        }
      ).addTo(map)

      bordersLayerRef.current.setZIndex(2)
    })
  }, [mapReady, layers.overlays.borderLines])

  // -------------------------------------------------------------------------
  // Night Boundary (day/night terminator computed client-side)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return
      if (nightLayerRef.current) {
        map.removeLayer(nightLayerRef.current)
        nightLayerRef.current = null
      }
      if (!layers.overlays.nightBoundary) return

      // Compute solar terminator points
      const now = new Date()
      const dayOfYear = Math.floor(
        (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
      )
      const declination = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365)
      const hourAngle = (now.getUTCHours() + now.getUTCMinutes() / 60) * 15 - 180

      const points: [number, number][] = []
      for (let lng = -180; lng <= 180; lng += 2) {
        const cosLHA = Math.cos(((lng - hourAngle) * Math.PI) / 180)
        const tanDec = Math.tan((declination * Math.PI) / 180)
        const lat = Math.atan(-cosLHA / tanDec) * (180 / Math.PI)
        points.push([lat, lng])
      }

      // Create polygon covering nighttime area
      const nightPoly: [number, number][] = [
        ...points,
        [declination > 0 ? -90 : 90, 180],
        [declination > 0 ? -90 : 90, -180],
      ]

      nightLayerRef.current = L.polygon(nightPoly, {
        color: "transparent",
        fillColor: "#000033",
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(map)
    })
  }, [mapReady, layers.overlays.nightBoundary])

  // -------------------------------------------------------------------------
  // Crosshair — Leaflet polylines (NOT CSS overlay, which destroys the map)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      // Clean up previous crosshair
      if (crosshairGroupRef.current) {
        map.removeLayer(crosshairGroupRef.current)
        crosshairGroupRef.current = null
      }
      if (!layers.overlays.crosshair) return

      const group = L.layerGroup().addTo(map)
      crosshairGroupRef.current = group

      const lineStyle = {
        color: "#ef4444",
        weight: 1,
        opacity: 0.6,
        dashArray: "6,4",
        interactive: false,
      }

      let hLine: any = null
      let vLine: any = null
      let centerDot: any = null

      const draw = () => {
        const center = map.getCenter()
        const bounds = map.getBounds()
        const n = bounds.getNorth()
        const s = bounds.getSouth()
        const e = bounds.getEast()
        const w = bounds.getWest()

        if (hLine) {
          hLine.setLatLngs([[center.lat, w], [center.lat, e]])
          vLine.setLatLngs([[n, center.lng], [s, center.lng]])
          centerDot.setLatLng(center)
        } else {
          hLine = L.polyline([[center.lat, w], [center.lat, e]], lineStyle).addTo(group)
          vLine = L.polyline([[n, center.lng], [s, center.lng]], lineStyle).addTo(group)
          centerDot = L.circleMarker(center, {
            radius: 4,
            fillColor: "#ef4444",
            color: "#ef4444",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8,
            interactive: false,
          }).addTo(group)
        }
      }

      draw()
      map.on("move", draw)
      map.on("zoom", draw)

      // Store cleanup handler on the group so we can remove listeners
      ;(group as any)._rrCleanup = () => {
        map.off("move", draw)
        map.off("zoom", draw)
      }
    })

    return () => {
      if (crosshairGroupRef.current) {
        ;(crosshairGroupRef.current as any)._rrCleanup?.()
      }
    }
  }, [mapReady, layers.overlays.crosshair])

  // -------------------------------------------------------------------------
  // Sentinel-1 Flood Extent (simulated GeoJSON)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    import("leaflet").then((L) => {
      const map = mapRef.current
      if (!map) return

      if (sentinelGroupRef.current) {
        map.removeLayer(sentinelGroupRef.current)
        sentinelGroupRef.current = null
      }
      if (!layers.sentinel.enabled || !layers.sentinel.acquisitionDate) return

      import("@/lib/sentinel-mock-data").then(({ getFloodExtent }) => {
        const extent = getFloodExtent(layers.sentinel.acquisitionDate)
        if (!extent || !mapRef.current) return

        const group = L.layerGroup().addTo(map)
        sentinelGroupRef.current = group

        L.geoJSON(extent.geojson as any, {
          style: (feature: any) => {
            const zone = feature?.properties?.zone
            const type = feature?.properties?.type
            const isFlood = type === "flood"

            return {
              fillColor:
                zone === "A" ? "#dc2626" :   // red — critical dike area
                zone === "B" ? "#ea580c" :   // orange — residential
                zone === "C" ? "#f59e0b" :   // amber — fields
                isFlood ? "#f97316" :         // orange default flood
                "#3b82f6",                    // blue — normal water body
              fillOpacity: layers.sentinel.opacity * 0.55,
              color:
                zone === "A" ? "#991b1b" :
                zone === "B" ? "#9a3412" :
                zone === "C" ? "#92400e" :
                isFlood ? "#c2410c" :
                "#1d4ed8",
              weight: 2,
              opacity: 0.8,
            }
          },
          onEachFeature: (feature: any, layer: any) => {
            const p = feature.properties || {}
            layer.bindPopup(
              `<div style="font-family:system-ui;padding:4px;min-width:180px;">` +
              `<strong>Sentinel-1 Detection</strong><br/>` +
              `<small style="color:#888;">${p.label || "Flood area"}</small><br/><br/>` +
              `Type: <strong>${p.type === "flood" ? "FLOOD" : "Water body"}</strong><br/>` +
              (p.zone ? `Zone: <strong>${p.zone}</strong><br/>` : "") +
              `Confidence: <strong>${((p.confidence || 0) * 100).toFixed(0)}%</strong><br/>` +
              `<small>Acquired: ${new Date(extent.date).toLocaleDateString()}</small>` +
              `</div>`
            )
          },
        }).addTo(group)

        group.setZIndex?.(7)
      })
    })
  }, [mapReady, layers.sentinel.enabled, layers.sentinel.acquisitionDate, layers.sentinel.opacity])

  // -------------------------------------------------------------------------
  // Flood zone polygons
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !zoneGroupRef.current) return

    import("leaflet").then((L) => {
      const group = zoneGroupRef.current
      if (!group) return
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
  }, [mapReady, snapshot?.overallStatus, layers.showFloodZones])

  // -------------------------------------------------------------------------
  // Sensor markers
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady || !markerGroupRef.current) return

    import("leaflet").then((L) => {
      const group = markerGroupRef.current
      if (!group) return
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
            reading.status === "warning" ? "#f59e0b" : "#3b82f6"

        const iconLabel =
          sensorId === "ultrasonic_water_level" ? "W" :
            sensorId === "capacitive_soil_moisture" ? "S" : "H"

        const icon = L.divIcon({
          className: "rr-marker",
          html: `<div style="
            background:${color}; width:32px; height:32px; border-radius:50%;
            border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.4);
            display:flex; align-items:center; justify-content:center;
            color:white; font-weight:bold; font-size:13px;
          ">${iconLabel}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })

        const marker = L.marker(pos, { icon }).addTo(group)

        const validityBadge = reading.isValid
          ? ""
          : `<br/><span style="color:orange;font-weight:bold;">⚠ Fallback value</span>`

        marker.bindPopup(`
          <div style="font-family:system-ui;padding:4px;min-width:180px;">
            <strong>${meta.label}</strong><br/>
            <small style="color:#666;">${meta.placement}</small><br/><br/>
            Value: <strong>${formatSensorValue(sensorId, reading.effectiveValue, unit)}</strong><br/>
            Status: <span style="color:${color};font-weight:bold;">${reading.status.toUpperCase()}</span>
            ${validityBadge}<br/>
            <small>Updated: ${reading.timestamp.toLocaleTimeString()}</small>
          </div>
        `)
      })
    })
  }, [mapReady, snapshot, unit, layers.showSensorMarkers])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative">
      {/* Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />

      <style>{`
        .leaflet-container { background: #0c0c14; }
        .rr-marker { background: transparent !important; border: none !important; }
        /* Remove tile gap lines */
        .leaflet-tile { outline: 0 !important; }
        /* Instant tile appearance — no fade = no flicker */
        .leaflet-tile-container img { will-change: auto; }
        /* Crosshair is now Leaflet polylines — no CSS overlay needed */
      `}</style>

      {/* Loading indicator */}
      {(tileLoading || rainViewerLoading) && (
        <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md px-2.5 py-1.5 flex items-center gap-2 border border-border">
          <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-[11px] text-muted-foreground">Loading tiles…</span>
        </div>
      )}

      {/* Map container */}
      <div
        ref={containerRef}
        className="h-[400px] md:h-[550px] lg:h-[600px] w-full rounded-lg border border-border"
        style={{ zIndex: 0 }}
      />

      {/* Coordinates display (like Zoom Earth bottom-left) */}
      <div className="absolute bottom-2 left-2 z-10 bg-background/70 backdrop-blur-sm rounded px-2 py-1 text-[10px] font-mono text-muted-foreground">
        {DEPLOYMENT.coordinates.lat.toFixed(4)}°N, {DEPLOYMENT.coordinates.lng.toFixed(4)}°E
      </div>
    </div>
  )
}
