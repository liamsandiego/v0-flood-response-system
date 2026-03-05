"use client"

import { useEffect, useRef } from "react"
import type { SensorSnapshot, MeasurementUnit } from "@/lib/types"
import { DEPLOYMENT, SENSOR_REGISTRY, ALL_SENSOR_IDS } from "@/lib/constants"
import { formatSensorValue } from "@/lib/conversion"

interface FloodMapProps {
  snapshot: SensorSnapshot | null
  unit: MeasurementUnit
}

/**
 * Map positions for each sensor relative to the Obando dike station.
 * In a real deployment these would come from GPS coordinates on the devices.
 */
const SENSOR_POSITIONS: Record<string, [number, number]> = {
  ultrasonic_water_level: [14.7097, 120.9355],  // upstream face of dike
  capacitive_soil_moisture: [14.7091, 120.9360], // embedded in dike body
  humidity_dht22: [14.7094, 120.9365],           // dike-top railing
}

export function FloodMap({ snapshot, unit }: FloodMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const polygonsRef = useRef<any[]>([])

  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return

    import("leaflet").then((L) => {
      // Initialize map only once, centered on Obando dike
      if (!mapInstanceRef.current) {
        try {
          mapInstanceRef.current = L.map(mapRef.current!).setView(
            [DEPLOYMENT.coordinates.lat, DEPLOYMENT.coordinates.lng],
            DEPLOYMENT.mapZoom
          )

          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          }).addTo(mapInstanceRef.current)
        } catch (err) {
          console.error("[FloodMap] Failed to initialize map:", err)
          return
        }
      }

      // -----------------------------------------------------------------------
      // Dynamic Updates: Polygons (Zones)
      // -----------------------------------------------------------------------

      // Clear existing polygons
      polygonsRef.current.forEach((poly) => {
        try { poly.remove() } catch { /* already removed */ }
      })
      polygonsRef.current = []

      // Render Segmented Flood Zones
      DEPLOYMENT.FLOOD_ZONES.forEach((zone) => {
        // Determine dynamic style based on alert status
        let fillColor = "#22c55e" // Default Green (Safe)
        let opacity = 0.2

        if (snapshot?.overallStatus === "critical") {
          if (zone.id === "zone_a") { fillColor = "#ef4444"; opacity = 0.6 } // Red
          else if (zone.id === "zone_b") { fillColor = "#f97316"; opacity = 0.4 } // Orange
          else { fillColor = "#eab308"; opacity = 0.3 } // Yellow
        } else if (snapshot?.overallStatus === "warning") {
          if (zone.id === "zone_a") { fillColor = "#f97316"; opacity = 0.4 }
          else { fillColor = "#eab308"; opacity = 0.3 }
        }

        const polygon = L.polygon(zone.coordinates, {
          color: fillColor,
          fillColor: fillColor,
          fillOpacity: opacity,
          weight: 2,
          dashArray: "5,5",
        })
          .addTo(mapInstanceRef.current)
          .bindPopup(
            `<strong>${zone.name}</strong><br/>` +
            `Status: ${snapshot?.overallStatus === "critical" && zone.id === "zone_a" ? "CRITICAL" : "NORMAL"}<br/>` +
            `<small>Monitored Area</small>`
          )

        polygonsRef.current.push(polygon)
      })

      // -----------------------------------------------------------------------
      // Dynamic Updates: Markers
      // -----------------------------------------------------------------------

      // Clear existing markers
      markersRef.current.forEach((marker) => {
        try { marker.remove() } catch { /* already removed */ }
      })
      markersRef.current = []

      if (!snapshot) return

      // Add sensor markers
      ALL_SENSOR_IDS.forEach((sensorId) => {
        const meta = SENSOR_REGISTRY[sensorId]
        const reading =
          sensorId === "ultrasonic_water_level" ? snapshot.waterLevel :
            sensorId === "capacitive_soil_moisture" ? snapshot.soilMoisture :
              snapshot.humidity
        const pos = SENSOR_POSITIONS[sensorId]

        const color =
          reading.status === "critical" ? "#ef4444" :
            reading.status === "warning" ? "#f59e0b" :
              "#3b82f6"

        const iconLabel =
          sensorId === "ultrasonic_water_level" ? "W" :
            sensorId === "capacitive_soil_moisture" ? "S" :
              "H"

        const icon = L.divIcon({
          className: "custom-marker",
          html: `
            <div style="
              background-color: ${color};
              width: 32px;
              height: 32px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: bold;
              font-size: 13px;
            ">
              ${iconLabel}
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })

        const marker = L.marker(pos, { icon }).addTo(mapInstanceRef.current)

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

        markersRef.current.push(marker)
      })
    }).catch((err) => {
      console.error("[FloodMap] Failed to load Leaflet:", err)
    })
  }, [snapshot, unit])

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <div ref={mapRef} className="h-[300px] md:h-[500px] w-full rounded-lg border border-border" />
    </>
  )
}
