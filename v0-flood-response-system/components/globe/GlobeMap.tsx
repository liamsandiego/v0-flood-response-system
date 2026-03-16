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
import { getFloodExtent, fetchFloodExtent } from "@/lib/sentinel-mock-data";
import "mapbox-gl/dist/mapbox-gl.css";

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

// Zone color mapping for Sentinel-1 flood polygons
const ZONE_COLORS: Record<string, string> = {
  A: "#dc2626",
  B: "#ea580c",
  C: "#f59e0b",
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

// Sentinel color expression using "case" (handles null zone values)
const SENTINEL_FILL_COLOR: unknown = [
  "case",
  ["==", ["get", "zone"], "A"], ZONE_COLORS.A,
  ["==", ["get", "zone"], "B"], ZONE_COLORS.B,
  ["==", ["get", "zone"], "C"], ZONE_COLORS.C,
  "#3b82f6",
];
const SENTINEL_LINE_COLOR: unknown = [
  "case",
  ["==", ["get", "zone"], "A"], ZONE_COLORS.A,
  ["==", ["get", "zone"], "B"], ZONE_COLORS.B,
  ["==", ["get", "zone"], "C"], ZONE_COLORS.C,
  "#60a5fa",
];

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
  /** RainViewer tile URLs per frame — Zoom Earth pattern (all mounted, opacity toggle) */
  rainViewerTileUrls?: string[];
  /** Which RainViewer frame is currently visible */
  rainViewerActiveIndex?: number;
}

export default function GlobeMap({
  layerConfig,
  himawariFrames,
  himawariActiveIndex,
  himawariMaxZoom,
  rainViewerTileUrls,
  rainViewerActiveIndex,
}: GlobeMapProps) {
  const mapRef = useRef<MapRef>(null);
  const sensorData = useFloodStore((s) => s.sensorData);
  const criticalMode = useFloodStore((s) => s.criticalMode);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  const [mapStyleLocal, setMapStyleLocal] = useState("dark");

  const mapStyle = layerConfig ? layerConfig.baseMap : mapStyleLocal;

  const [showRainViewerLocal, setShowRainViewerLocal] = useState(false);
  const [rainViewerOpacityLocal, setRainViewerOpacityLocal] = useState(0.6);

  const showRainViewer = layerConfig ? layerConfig.rainViewer.enabled : showRainViewerLocal;
  const rainViewerOpacity = layerConfig ? layerConfig.rainViewer.opacity : rainViewerOpacityLocal;
  const showHimawari = layerConfig?.himawari.enabled ?? false;
  const showSentinel = layerConfig?.sentinel.enabled ?? false;

  const markerData = enrichSensorData(sensorData);

  // ── Sentinel-1 flood extent GeoJSON (backend → mock fallback) ──
  const [sentinelGeoJSON, setSentinelGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    if (!layerConfig?.sentinel.enabled) {
      setSentinelGeoJSON(null);
      return;
    }
    const acqDate = layerConfig.sentinel.acquisitionDate;
    let cancelled = false;

    // Try backend first
    fetchFloodExtent(acqDate)
      .then((result) => {
        if (cancelled) return;
        if (result?.geojson) {
          console.log("[Sentinel] Loaded from backend:", result.id, result.source, `flood_extent=${result.floodExtent}`);
          setSentinelGeoJSON(result.geojson as GeoJSON.FeatureCollection);
        } else {
          // Fall back to mock
          console.log("[Sentinel] Backend unavailable, using mock data");
          const extent = getFloodExtent(acqDate);
          setSentinelGeoJSON(extent?.geojson ?? null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        console.log("[Sentinel] Backend error, using mock fallback");
        const extent = getFloodExtent(acqDate);
        setSentinelGeoJSON(extent?.geojson ?? null);
      });

    return () => { cancelled = true; };
  }, [layerConfig?.sentinel.enabled, layerConfig?.sentinel.acquisitionDate]);

  // ── Setup terrain + fog helper ──
  const setupTerrainAndFog = useCallback((map: mapboxgl.Map) => {
    try {
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 10,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
    } catch (e) {
      // Terrain may already exist after hot reload
    }

    map.setFog({
      color: "rgb(10, 10, 25)",
      "high-color": "rgb(20, 20, 60)",
      "horizon-blend": 0.08,
      "space-color": "rgb(5, 5, 15)",
      "star-intensity": 0.6,
    });
  }, []);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    setupTerrainAndFog(map);
    setMapLoaded(true);
    setStyleReady(true);

    // Suppress noisy tile-fetch errors from RainViewer / Himawari in the console.
    // Mapbox fires "error" events for every 404 tile. Without this, the console
    // fills with hundreds of "Failed to fetch" messages for tiles outside radar
    // coverage, which is expected & harmless.
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
        // Silently swallow expected tile errors
        return;
      }
      // Let other map errors through
      console.warn("[GlobeMap] Map error:", e.error);
    });

    console.log("[GlobeMap] Map loaded, sensors:", sensorData.features.length);
  }, [setupTerrainAndFog, sensorData.features.length]);

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
        projection={{ name: "globe" }}
        maxPitch={85}
        onLoad={onLoad}
        onClick={onClick}
        preserveDrawingBuffer
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

        {/* ── RainViewer radar overlay (Zoom Earth pattern) ──
             All frames permanently mounted (stable keys = no remount).
             Use layout visibility to prevent tile fetching for non-active frames.
             Only the active + 1 preload neighbor actually fetch tiles. */}
        {styleReady && showRainViewer && rainViewerTileUrls?.map((url, i) => {
          const active = rainViewerActiveIndex ?? 0;
          const len = rainViewerTileUrls.length;
          const nextIdx = (active + 1) % len;
          // Active frame + next frame are "visible" (tiles fetched).
          // All others are "none" (Mapbox skips tile loading entirely).
          const shouldLoad = i === active || i === nextIdx;
          return (
            <Source
              key={`rv-${i}`}
              id={`rainviewer-${i}`}
              type="raster"
              tiles={[url]}
              tileSize={256}
              maxzoom={12}
            >
              <Layer
                id={`rainviewer-layer-${i}`}
                type="raster"
                layout={{
                  visibility: shouldLoad ? "visible" : "none",
                }}
                paint={{
                  "raster-opacity": i === active ? rainViewerOpacity : 0,
                  "raster-fade-duration": 0,
                }}
              />
            </Source>
          );
        })}

        {/* ── Sentinel-1 flood extent polygons ── */}
        {styleReady && showSentinel && sentinelGeoJSON && (
          <Source id="sentinel-flood" type="geojson" data={sentinelGeoJSON}>
            <Layer
              id="sentinel-flood-fill"
              type="fill"
              paint={{
                "fill-color": SENTINEL_FILL_COLOR as mapboxgl.Expression,
                "fill-opacity": (layerConfig?.sentinel.opacity ?? 0.7) * 0.5,
              }}
            />
            <Layer
              id="sentinel-flood-outline"
              type="line"
              paint={{
                "line-color": SENTINEL_LINE_COLOR as mapboxgl.Expression,
                "line-width": 2,
                "line-opacity": layerConfig?.sentinel.opacity ?? 0.7,
              }}
            />
            <Layer
              id="sentinel-flood-labels"
              type="symbol"
              layout={{
                "text-field": ["get", "label"],
                "text-size": 11,
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
        {styleReady && markerData.features.length > 0 && (
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

          <div className="backdrop-blur-xl bg-slate-900/70 border border-white/10 rounded-lg p-2 space-y-1.5">
            <span className="text-[9px] text-white/40 uppercase tracking-wider font-semibold block">Overlays</span>
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-[10px] text-white/70">RainViewer Radar</span>
              <input
                type="checkbox"
                checked={showRainViewerLocal}
                onChange={(e) => setShowRainViewerLocal(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-cyan-500"
              />
            </label>
            {showRainViewerLocal && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[9px] text-white/40">
                  <span>Opacity</span>
                  <span>{Math.round(rainViewerOpacityLocal * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.1"
                  value={rainViewerOpacityLocal}
                  onChange={(e) => setRainViewerOpacityLocal(Number(e.target.value))}
                  className="w-full h-1 accent-cyan-500"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
