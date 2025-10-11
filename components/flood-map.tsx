"use client"

import { useEffect, useRef } from "react"
import type { SensorData } from "@/lib/types"

interface FloodMapProps {
  sensors: SensorData[]
}

export function FloodMap({ sensors }: FloodMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return

    // Dynamically import Leaflet only on client side
    import("leaflet").then((L) => {
      // Initialize map only once
      if (!mapInstanceRef.current) {
        // Center on Barangay East Rembo, Taguig
        mapInstanceRef.current = L.map(mapRef.current!).setView([14.5547, 121.0503], 15)

        // Add OpenStreetMap tiles
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(mapInstanceRef.current)

        // Add flood-prone zone overlay (example polygon)
        const floodZone = L.polygon(
          [
            [14.5557, 121.0493],
            [14.5557, 121.0513],
            [14.5537, 121.0513],
            [14.5537, 121.0493],
          ],
          {
            color: "red",
            fillColor: "#ff0000",
            fillOpacity: 0.2,
            weight: 2,
          },
        ).addTo(mapInstanceRef.current)

        floodZone.bindPopup("High-Risk Flood Zone")
      }

      // Clear existing markers
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []

      // Add sensor markers
      sensors.forEach((sensor) => {
        const color = sensor.status === "critical" ? "red" : sensor.status === "warning" ? "orange" : "blue"

        // Create custom icon
        const icon = L.divIcon({
          className: "custom-marker",
          html: `
            <div style="
              background-color: ${color};
              width: 30px;
              height: 30px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-weight: bold;
              font-size: 12px;
            ">
              ${sensor.id.split("_")[1]}
            </div>
          `,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        })

        const marker = L.marker([sensor.lat, sensor.lng], { icon }).addTo(mapInstanceRef.current)

        marker.bindPopup(`
          <div style="font-family: system-ui; padding: 4px;">
            <strong>${sensor.name}</strong><br/>
            Water Level: ${sensor.waterLevel.toFixed(2)}m<br/>
            Rainfall: ${sensor.rainfall.toFixed(1)}mm<br/>
            Status: <span style="color: ${color}; font-weight: bold;">${sensor.status.toUpperCase()}</span><br/>
            <small>Updated: ${sensor.lastUpdate.toLocaleTimeString()}</small>
          </div>
        `)

        markersRef.current.push(marker)
      })
    })
  }, [sensors])

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <div ref={mapRef} className="h-[500px] w-full rounded-lg border border-border" />
    </>
  )
}
