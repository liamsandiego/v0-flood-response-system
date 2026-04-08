// =============================================================================
// RapidRelay – 3D Globe Map (Mapbox GL JS v3)
//
// Full-screen 3D globe with terrain, atmospheric fog, sensor markers.
// Includes: Map style selector (Satellite/Dark/Streets/Outdoors)
//           RainViewer radar overlay as raster tiles
//           Himawari satellite overlay (NASA GIBS)
//           Sentinel-1 flood extent polygons (real GEE data + mock fallback)
//           3D terrain with DEM
// =============================================================================

"use client";

import React from "react";
import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import Map, {
  Source,
  Layer,
  type MapRef,
  type MapMouseEvent,
} from "react-map-gl/mapbox";
import { useFloodStore } from "@/stores/sensorStore";
import type { SensorGeoJSON, AlertLevel } from "@/stores/sensorStore";
import type { MapLayerConfig } from "@/lib/map-types";
import type { HimawariFrame } from "@/hooks/use-himawari";
// @ts-ignore - mapbox-gl CSS types missing in declaration
import "mapbox-gl/dist/mapbox-gl.css";

// MapErrorBoundary lives in its own file — re-exported here for backwards compat
export { MapErrorBoundary } from "@/components/globe/MapErrorBoundary";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// PAGASA Obando Station — exact sensor coordinates
const INITIAL_VIEW = {
  longitude: 120.937613,
  latitude: 14.707225,
  zoom: 14,
  pitch: 50,
  bearing: -15,
};

const ALERT_COLORS: Record<AlertLevel, string> = {
  CLEAR: "#10b981",
  WATCH: "#f59e0b",
  WARNING: "#f97316",
  DANGER: "#ef4444",
};

// Available map styles
const MAP_STYLES: Record<string, { label: string; url: string }> = {
  dark: { label: "Dark", url: "mapbox://styles/mapbox/dark-v11" },
  satellite: {
    label: "Satellite",
    url: "mapbox://styles/mapbox/satellite-streets-v12",
  },
  streets: { label: "Streets", url: "mapbox://styles/mapbox/streets-v12" },
  outdoors: { label: "Terrain", url: "mapbox://styles/mapbox/outdoors-v12" },
};



// Enrich sensor data with alert level and color
function enrichSensorData(data: SensorGeoJSON) {
  const features = data.features.map((f) => {
    const wl = f.properties.water_level ?? 0;
    const alert = classifySensorAlert(wl);
    return {
      type: "Feature" as const,
      geometry: f.geometry,
      properties: {
        ...f.properties,
        alert_level: alert,
        color: ALERT_COLORS[alert],
        marker_radius: Math.min(Math.max(wl * 8, 8), 25),
      },
    };
  });
  return { type: "FeatureCollection" as const, features };
}

function classifySensorAlert(waterLevel: number): AlertLevel {
  if (waterLevel >= 2.5) return "DANGER";
  if (waterLevel >= 1.5) return "WARNING";
  if (waterLevel >= 0.8) return "WATCH";
  return "CLEAR";
}

// Area of Interest GeoJSON — Polygon from aoi.geojson (first line)
const aoiData = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { name: "Obando AOI" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[
          [120.92134967914029, 14.730750011539854],
          [120.92998042205943, 14.734210915448301],
          [120.93108208177563, 14.733573906020567],
          [120.93095410769473, 14.73153602141528],
          [120.93284451704676, 14.728644635229003],
          [120.9329516832205, 14.72630760843795],
          [120.93386690121156, 14.725395227809528],
          [120.93638554551313, 14.720381719132348],
          [120.93696533576468, 14.71883491086598],
          [120.93947491052211, 14.715702484269713],
          [120.94260839548315, 14.715109653613183],
          [120.9451303418079, 14.712180950561574],
          [120.94635091882884, 14.708715230652999],
          [120.9474909951951, 14.708689266844601],
          [120.94857421431334, 14.705067960551204],
          [120.95080031482678, 14.702810904184474],
          [120.95105810216842, 14.701528054692247],
          [120.9520843472472, 14.700363712292244],
          [120.95249023143475, 14.69874499431586],
          [120.95552313998974, 14.697217572581394],
          [120.95606431890644, 14.695059248193985],
          [120.94885112053913, 14.693968951624981],
          [120.94823333239401, 14.69490489972847],
          [120.92134967914029, 14.730750011539854]
        ]]
      }
    }
  ]
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GlobeMapProps {
  layerConfig?: MapLayerConfig;
  /** All Himawari frames — each rendered as a permanent source (Zoom Earth pattern) */
  himawariFrames?: HimawariFrame[];
  /** Which frame index is currently visible */
  himawariActiveIndex?: number;
  himawariMaxZoom?: number;
  /** Touch device — disable terrain/globe for GPU performance */
  isTouch?: boolean;
}

export default function GlobeMap({
  layerConfig,
  himawariFrames,
  himawariActiveIndex,
  himawariMaxZoom,
  isTouch = false,
}: GlobeMapProps) {
  const mapRef = useRef<MapRef>(null);
  const sensorData = useFloodStore((s) => s.sensorData);
  const criticalMode = useFloodStore((s) => s.criticalMode);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  const [mapStyleLocal, setMapStyleLocal] = useState("dark");

  // Edge browser detection — reduce GPU features to prevent glitches
  const isEdge = typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent);

  const mapStyle = layerConfig ? layerConfig.baseMap : mapStyleLocal;

  const showHimawari = layerConfig?.himawari.enabled ?? false;

  // Memoize sensor data enrichment to prevent re-creation on every render
  const markerData = useMemo(() => enrichSensorData(sensorData), [sensorData]);

  // ── Setup terrain + fog helper ──
  const setupTerrainAndFog = useCallback((map: mapboxgl.Map) => {
    // Skip terrain on touch devices — DEM tile fetching + 3D mesh rendering
    // is the biggest GPU drain and causes crashes on tablet browsers
    if (!isTouch) {
      try {
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
            maxzoom: isEdge ? 8 : 10, // Reduce on Edge to prevent glitches
          });
        }
        map.setTerrain({
          source: "mapbox-dem",
          exaggeration: isEdge ? 1.0 : 1.5, // Lower on Edge for stability
        });
      } catch (e) {
        // Terrain may already exist after hot reload
      }
    }

    // Simplified fog on touch devices to reduce GPU load
    if (isTouch) {
      map.setFog({
        color: "rgb(10, 10, 25)",
        "high-color": "rgb(20, 20, 60)",
        "horizon-blend": 0.02,
        "space-color": "rgb(5, 5, 15)",
        "star-intensity": 0.2,
      });
    } else {
      map.setFog({
        color: "rgb(10, 10, 25)",
        "high-color": "rgb(20, 20, 60)",
        "horizon-blend": 0.08,
        "space-color": "rgb(5, 5, 15)",
        "star-intensity": 0.6,
      });
    }
  }, [isTouch, isEdge]);

  // ── Visibility change handler — pause rendering when tab hidden ──
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleVisibility = () => {
      if (document.hidden) {
        // Reduce frame rate to ~1 FPS when hidden — saves GPU memory on mobile
        try {
          map.triggerRepaint();
        } catch { /* ok */ }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [mapLoaded]);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    setupTerrainAndFog(map);
    setMapLoaded(true);
    setStyleReady(true);

    // Suppress noisy tile-fetch errors from RainViewer / Himawari in the console.
    map.on("error", (e) => {
      const msg = e.error?.message ?? "";
      if (
        msg.includes("tiles") ||
        msg.includes("tilecache.rainviewer.com") ||
        msg.includes("gibs.earthdata.nasa.gov") ||
        msg.includes("Failed to fetch") ||
        msg.includes("status: 404") ||
        msg.includes("status: 408")
      ) {
        return;
      }
      console.warn("[GlobeMap] Map error:", e.error);
    });

    // ── Touch stability: disable rotation on mobile (prevents gesture conflicts) ──
    if (isTouch) {
      try {
        map.touchZoomRotate.disableRotation();
      } catch { /* ok if not supported */ }
    }

    // ── WebGL context lost handler ──
    const canvas = map.getCanvas();
    const handleContextLost = (e: Event) => {
      console.error("[GlobeMap] WebGL context lost");
      e.preventDefault(); // Allow recovery attempt
    };
    const handleContextRestored = () => {
      console.log("[GlobeMap] WebGL context restored, re-rendering");
      map.triggerRepaint();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    // ── Recenter on flood zone event listener ──
    const handleFitBounds = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { bounds } = customEvent.detail;
      if (bounds) {
        map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          { padding: 50, duration: 1000 }
        );
      }
    };
    window.addEventListener("map:fitBounds", handleFitBounds);

    // ── FlyTo event listener (for Recenter button) ──
    const handleFlyTo = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { lat, lng, zoom } = customEvent.detail;
      if (lat != null && lng != null) {
        map.flyTo({
          center: [lng, lat],
          zoom: zoom ?? 15,
          duration: 1000,
        });
      }
    };
    window.addEventListener("map:flyTo", handleFlyTo);

    console.log("[GlobeMap] Map loaded, sensors:", sensorData.features.length, isEdge ? "(Edge mode)" : "");

    // Cleanup event listener on unmount
    return () => {
      window.removeEventListener("map:fitBounds", handleFitBounds);
      window.removeEventListener("map:flyTo", handleFlyTo);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [setupTerrainAndFog, sensorData.features.length, isTouch, isEdge]);

  // Re-apply terrain + fog after style swap (Mapbox removes custom sources)
  const prevStyleRef = useRef(mapStyle);
  useEffect(() => {
    if (prevStyleRef.current === mapStyle) return;
    prevStyleRef.current = mapStyle;

    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;

    // Suppress Source rendering while style is loading
    setStyleReady(false);

    // Wait for style to fully load before re-adding terrain
    const handler = () => {
      setupTerrainAndFog(map);
      setStyleReady(true);
      map.off("style.load", handler);
    };
    map.on("style.load", handler);
  }, [mapStyle, mapLoaded, setupTerrainAndFog]);

  // Critical mode fog
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !mapLoaded) return;

    if (criticalMode) {
      map.setFog({
        color: "rgb(40, 10, 10)",
        "high-color": "rgb(60, 15, 15)",
        "horizon-blend": 0.1,
        "space-color": "rgb(20, 5, 5)",
        "star-intensity": 0.3,
      });
    } else {
      map.setFog({
        color: "rgb(10, 10, 25)",
        "high-color": "rgb(20, 20, 60)",
        "horizon-blend": 0.08,
        "space-color": "rgb(5, 5, 15)",
        "star-intensity": 0.6,
      });
    }
  }, [criticalMode, mapLoaded]);

  // ── Map Overlays: Labels ──
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !styleReady) return;
    const show = layerConfig?.overlays.mapLabels ?? true;
    const vis = show ? "visible" : "none";
    try {
      for (const layer of map.getStyle().layers ?? []) {
        if (
          layer.id.includes("-label") ||
          layer.id.startsWith("poi-") ||
          layer.id.includes("place-") ||
          layer.id.includes("road-label") ||
          layer.id.includes("waterway-label") ||
          layer.id.includes("natural-") ||
          layer.id.includes("transit-") ||
          layer.id.includes("airport-")
        ) {
          if (layer.type === "symbol") {
            map.setLayoutProperty(layer.id, "visibility", vis);
          }
        }
      }
    } catch { /* style may not have these layers */ }
  }, [layerConfig?.overlays.mapLabels, styleReady]);

  // ── Map Overlays: Border Lines ──
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !styleReady) return;
    const show = layerConfig?.overlays.borderLines ?? true;
    const vis = show ? "visible" : "none";
    try {
      for (const layer of map.getStyle().layers ?? []) {
        if (
          layer.id.includes("admin") ||
          layer.id.includes("boundary") ||
          layer.id.includes("border")
        ) {
          map.setLayoutProperty(layer.id, "visibility", vis);
        }
      }
    } catch { /* style may not have these layers */ }
  }, [layerConfig?.overlays.borderLines, styleReady]);

  // ── Map Overlays: Night Boundary (day/night terminator) ──
  const nightGeoJSON = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!(layerConfig?.overlays.nightBoundary)) return null;
    // Compute solar terminator polygon
    const now = new Date();
    const dayOfYear = Math.floor(
      (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
    );
    // Solar declination (approximate)
    const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
    const decRad = (declination * Math.PI) / 180;
    // Solar hour angle at current UTC time
    const hours = now.getUTCHours() + now.getUTCMinutes() / 60;
    const solarNoonLng = (12 - hours) * 15; // longitude where it's solar noon

    // Build terminator line
    const coords: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 1) {
      const latRad = (lat * Math.PI) / 180;
      // Hour angle where sun is at horizon
      const cosH = -Math.tan(latRad) * Math.tan(decRad);
      let lng: number;
      if (cosH < -1) {
        // Midnight sun — sun never sets
        lng = solarNoonLng + 180;
      } else if (cosH > 1) {
        // Polar night — sun never rises
        lng = solarNoonLng;
      } else {
        const haDeg = (Math.acos(cosH) * 180) / Math.PI;
        lng = solarNoonLng - haDeg;
      }
      // Normalize lng to [-180, 180]
      lng = ((lng + 540) % 360) - 180;
      coords.push([lng, lat]);
    }
    // Close the polygon on the night side (east of terminator)
    const nightPoly: [number, number][] = [
      ...coords,
      [coords[coords.length - 1][0] + 180, 90],
      [coords[0][0] + 180, -90],
      coords[0],
    ];

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [nightPoly] },
          properties: {},
        },
      ],
    };
  }, [layerConfig?.overlays.nightBoundary]);

  // Fly to sensor on click
  const onClick = useCallback((e: MapMouseEvent) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // Guard: layer may not exist yet if no sensor data has loaded
    if (!map.getLayer("sensor-markers")) return;
    try {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["sensor-markers"],
      });
      if (features.length > 0) {
        const coords = (features[0].geometry as GeoJSON.Point).coordinates;
        map.flyTo({ center: [coords[0], coords[1]], zoom: 16, pitch: 60, duration: 1500 });
      }
    } catch {
      // Layer may not exist yet
    }
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <div className="text-6xl">🌍</div>
          <h2 className="text-xl font-mono text-white/80">MAPBOX TOKEN REQUIRED</h2>
          <p className="text-sm text-white/50 max-w-md font-mono">
            Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={INITIAL_VIEW}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        mapStyle={(MAP_STYLES[mapStyle] ?? MAP_STYLES.dark).url}
        projection={{ name: isTouch ? "mercator" : "globe" }}
        maxPitch={isTouch ? 60 : 85}
        onLoad={onLoad}
        onClick={onClick}
        {...(!isTouch && !isEdge && { preserveDrawingBuffer: true })}
        {...((isTouch || isEdge) && { maxTileCacheSize: 50 })}
        attributionControl={false}
      >
        {/* ── Himawari satellite overlay (Zoom Earth pattern) ──
             ALL frames mounted as permanent sources. Only raster-opacity
             toggles — no source teardown, no tile re-fetch. Once tiles
             load on first play-through, they stay in GPU tile cache. */}
        {styleReady && showHimawari && himawariFrames?.map((frame, i) => (
          <Source
            key={frame.time}
            id={`himawari-${i}`}
            type="raster"
            tiles={[frame.url]}
            tileSize={256}
            maxzoom={himawariMaxZoom ?? 6}
          >
            <Layer
              id={`himawari-layer-${i}`}
              type="raster"
              paint={{
                "raster-opacity": i === himawariActiveIndex
                  ? Math.min(layerConfig?.himawari.opacity ?? 0.7, 0.85)
                  : 0,
                "raster-fade-duration": 300,
              }}
            />
          </Source>
        ))}

        {styleReady && layerConfig?.showFloodZones && (
          <Source id="aoi" type="geojson" data={aoiData}>
            <Layer
              id="aoi-fill"
              type="fill"
              paint={{
                "fill-color": "#eab308",
                "fill-opacity": 0.08
              }}
            />
            <Layer
              id="aoi-line"
              type="line"
              paint={{
                "line-color": "#eab308",
                "line-width": 2.5,
                "line-opacity": 0.9,
                "line-dasharray": [2, 2]
              }}
            />
          </Source>
        )}

        {/* ── Night Boundary (day/night terminator) ── */}
        {styleReady && nightGeoJSON && (
          <Source id="night-boundary" type="geojson" data={nightGeoJSON}>
            <Layer
              id="night-boundary-fill"
              type="fill"
              paint={{
                "fill-color": "#000020",
                "fill-opacity": 0.3,
              }}
            />
            <Layer
              id="night-boundary-line"
              type="line"
              paint={{
                "line-color": "#fbbf24",
                "line-width": 1.5,
                "line-opacity": 0.6,
                "line-dasharray": [4, 3],
              }}
            />
          </Source>
        )}

        {/* ── Sensor markers ── */}
        {styleReady && markerData.features.length > 0 && layerConfig?.showSensorMarkers !== false && (
          <Source id="sensors" type="geojson" data={markerData}>
            <Layer
              id="sensor-glow"
              type="circle"
              paint={{
                "circle-radius": ["get", "marker_radius"],
                "circle-color": ["get", "color"],
                "circle-opacity": 0.25,
                "circle-blur": 1,
              }}
            />
            <Layer
              id="sensor-markers"
              type="circle"
              paint={{
                "circle-radius": ["*", ["get", "marker_radius"], 0.6],
                "circle-color": ["get", "color"],
                "circle-opacity": 0.9,
                "circle-stroke-width": 2,
                "circle-stroke-color": "rgba(255,255,255,0.4)",
              }}
            />
            <Layer
              id="sensor-dot"
              type="circle"
              paint={{
                "circle-radius": 3,
                "circle-color": "#ffffff",
                "circle-opacity": 0.9,
              }}
            />
            <Layer
              id="sensor-labels"
              type="symbol"
              layout={{
                "text-field": [
                  "concat",
                  ["get", "name"],
                  "\n",
                  ["to-string", ["round", ["*", ["get", "water_level"], 100]]],
                  "cm",
                ],
                "text-size": 11,
                "text-offset": [0, -2],
                "text-anchor": "bottom",
                "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
                "text-allow-overlap": true,
              }}
              paint={{
                "text-color": "#ffffff",
                "text-halo-color": "rgba(0,0,0,0.8)",
                "text-halo-width": 1.5,
              }}
            />
          </Source>
        )}
      </Map>

      {/* ── Crosshair overlay (CSS, always centered) ── */}
      {layerConfig?.overlays.crosshair && (
        <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
          <div className="relative w-10 h-10">
            <div className="absolute top-1/2 left-0 w-full h-px bg-white/50" />
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/50" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white/50" />
          </div>
        </div>
      )}

      {/* ─── Standalone controls (login page only) ─── */}
      {!layerConfig && (
        <div className="absolute top-14 right-2 z-10 pointer-events-auto flex flex-col gap-2">
          <div className="backdrop-blur-xl bg-slate-900/70 border border-white/10 rounded-lg p-2 space-y-1.5">
            <span className="text-[9px] text-white/40 uppercase tracking-wider font-semibold block">Base Map</span>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(MAP_STYLES).map(([key, style]) => (
                <button
                  key={key}
                  onClick={() => setMapStyleLocal(key)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    mapStyle === key
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-white/50 hover:text-white/80 hover:bg-white/5 border border-transparent"
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      )}
    </>
  );
}
