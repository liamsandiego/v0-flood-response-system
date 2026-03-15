"use client"

// =============================================================================
// RapidRelay – Map Controls Panel (v2)
//
// Full-featured control panel matching the spec layout:
//   - Base map selector
//   - Display toggles (Flood Zones, Sensors)
//   - Himawari Satellite (product, opacity, time, play/pause)
//   - RainViewer Radar (status, opacity, time scrubber, animation, legend)
//   - Sentinel-1 (Phase 2 placeholder)
//   - Map Overlays (labels, borders, night boundary, crosshair)
//
// Collapsible sections for mobile-friendly usage.
// =============================================================================

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Layers, Satellite, CloudRain, Radio, Eye, EyeOff,
  ChevronDown, ChevronUp, Palette, AlertTriangle,
  RefreshCw, Tag, Globe, Moon, Crosshair,
} from "lucide-react"
import type { MapLayerConfig, MapLayerActions, BaseMapStyle } from "@/lib/map-types"
import type { UseRainViewerReturn } from "@/hooks/use-rainviewer"
import type { UseHimawariReturn, HimawariFrame } from "@/hooks/use-himawari"
import { TimeScrubber } from "./TimeScrubber"
import { AnimationControls } from "./AnimationControls"
import { RainLegend } from "./Legend"
import { LayerToggle } from "./LayerToggle"
import { fetchFloodExtentList, getMockFloodExtentSummaries } from "@/lib/sentinel-mock-data"
import type { FloodExtentSummary } from "@/lib/sentinel-mock-data"

// Philippines is UTC+8.
// "Night" ≈ 18:00–06:00 local time → Himawari Visible shows near-black image.
// Uses UTC arithmetic to avoid toLocaleString/timezone ICU issues on Windows Node.
function isNightInPhilippines(): boolean {
  const phHour = (new Date().getUTCHours() + 8) % 24
  return phHour >= 18 || phHour < 6
}

/** Himawari animation state passed from AppShell */
export interface HimawariAnimationData {
  frames: HimawariFrame[]   // array of { time, label, url } objects
  currentIndex: number       // current frame index
}

interface MapControlsProps {
  config: MapLayerConfig
  actions: MapLayerActions
  rainViewer?: UseRainViewerReturn
  himawariAnimation?: HimawariAnimationData
  /** The useHimawari hook return for navigation callbacks */
  himawariHook?: UseHimawariReturn
  /** Whether to start collapsed (for mobile) */
  defaultCollapsed?: boolean
}

// ---------------------------------------------------------------------------
// Shared: Opacity Slider
// ---------------------------------------------------------------------------
function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[10px] text-muted-foreground w-12 shrink-0">Opacity</Label>
      <input
        type="range" min={0} max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-1.5 accent-primary cursor-pointer"
        style={{ touchAction: "none" }}
      />
      <span className="text-[10px] font-mono w-8 text-right">{Math.round(value * 100)}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground py-1"
      >
        {title}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-2 pt-1">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sentinel-1 Section (fetches real data from backend, falls back to mock)
// ---------------------------------------------------------------------------
function SentinelSection({ config, actions }: { config: MapLayerConfig; actions: MapLayerActions }) {
  const [extents, setExtents] = useState<FloodExtentSummary[]>([])
  const [dataSource, setDataSource] = useState<"loading" | "gee-csv" | "mock">("loading")

  // Fetch available dates from backend on mount
  useEffect(() => {
    fetchFloodExtentList()
      .then((list) => {
        if (list.length > 0) {
          setExtents(list)
          setDataSource("gee-csv")
        } else {
          setExtents(getMockFloodExtentSummaries())
          setDataSource("mock")
        }
      })
      .catch(() => {
        setExtents(getMockFloodExtentSummaries())
        setDataSource("mock")
      })
  }, [])

  const selectedExt = extents.find((e) => e.id === config.sentinel.acquisitionDate)
  const currentIndex = extents.findIndex((e) => e.id === config.sentinel.acquisitionDate)

  // Animation loop
  useEffect(() => {
    if (!config.sentinel.enabled || !config.sentinel.animating || extents.length === 0) return
    const interval = setInterval(() => {
      const idx = currentIndex >= 0 ? currentIndex : 0
      const next = (idx + 1) % extents.length
      actions.setSentinel({ acquisitionDate: extents[next].id })
    }, config.sentinel.animationSpeed)
    return () => clearInterval(interval)
  }, [config.sentinel.enabled, config.sentinel.animating, config.sentinel.animationSpeed, currentIndex, extents, actions])

  return (
    <div className="rounded-md border p-2.5 space-y-2">
      <LayerToggle
        label="Sentinel-1 Flood Extent"
        icon={<Radio className="h-4 w-4" />}
        enabled={config.sentinel.enabled}
        onToggle={() => {
          const willEnable = !config.sentinel.enabled
          if (willEnable && !config.sentinel.acquisitionDate && extents.length > 0) {
            const latest = extents[extents.length - 1]
            actions.setSentinel({ enabled: true, acquisitionDate: latest.id })
          } else {
            actions.setSentinel({ enabled: willEnable })
          }
        }}
        badge={dataSource === "gee-csv" ? "GEE Data" : dataSource === "mock" ? "Mock" : "..."}
        accentColor="text-orange-400"
      />

      <p className="text-[10px] text-muted-foreground leading-tight">
        {dataSource === "gee-csv"
          ? `Real GEE Sentinel-1 SAR data. ${extents.length} acquisitions (2017-2026).`
          : "SAR-derived flood extent simulation for Obando, Bulacan."}
      </p>

      {config.sentinel.enabled && (
        <div className="space-y-2 pt-0.5">
          {/* Animation controls (chronological playback) */}
          {extents.length > 1 && (
            <>
              <TimeScrubber
                currentIndex={currentIndex >= 0 ? currentIndex : 0}
                totalFrames={extents.length}
                nowIndex={extents.length - 1}
                timeLabel={selectedExt?.date ? new Date(selectedExt.date).toLocaleDateString() : "—"}
                relativeLabel={selectedExt?.status?.toUpperCase()}
                isForecast={false}
                onIndexChange={(i) => actions.setSentinel({ acquisitionDate: extents[i]?.id ?? null })}
                onStepBack={() => {
                  const prev = Math.max(0, (currentIndex >= 0 ? currentIndex : 0) - 1)
                  actions.setSentinel({ acquisitionDate: extents[prev].id })
                }}
                onStepForward={() => {
                  const next = Math.min(extents.length - 1, (currentIndex >= 0 ? currentIndex : 0) + 1)
                  actions.setSentinel({ acquisitionDate: extents[next].id })
                }}
                accentClass="accent-orange-400"
              />

              <AnimationControls
                playing={config.sentinel.animating}
                speed={config.sentinel.animationSpeed}
                onTogglePlay={() => actions.setSentinel({ animating: !config.sentinel.animating })}
                onSetSpeed={(ms) => actions.setSentinel({ animationSpeed: ms })}
                onPrev={() => {
                  const prev = Math.max(0, (currentIndex >= 0 ? currentIndex : 0) - 1)
                  actions.setSentinel({ acquisitionDate: extents[prev].id })
                }}
                onNext={() => {
                  const next = Math.min(extents.length - 1, (currentIndex >= 0 ? currentIndex : 0) + 1)
                  actions.setSentinel({ acquisitionDate: extents[next].id })
                }}
                onJumpBack={() => {
                  const prev = Math.max(0, (currentIndex >= 0 ? currentIndex : 0) - 10)
                  actions.setSentinel({ acquisitionDate: extents[prev].id })
                }}
                onJumpForward={() => {
                  const next = Math.min(extents.length - 1, (currentIndex >= 0 ? currentIndex : 0) + 10)
                  actions.setSentinel({ acquisitionDate: extents[next].id })
                }}
                onJumpToLatest={() => actions.setSentinel({ acquisitionDate: extents[extents.length - 1].id })}
                accentBg="bg-orange-500"
                accentBorder="border-orange-500"
              />
            </>
          )}

          {/* Date selector (dropdown) */}
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground w-12 shrink-0">Date</Label>
            <select
              value={config.sentinel.acquisitionDate ?? ""}
              onChange={(e) =>
                actions.setSentinel({ acquisitionDate: e.target.value || null })
              }
              className="flex-1 min-w-0 text-[10px] rounded border border-border bg-background px-1.5 py-1 truncate"
            >
              <option value="">Select acquisition...</option>
              {extents.map((ext) => (
                <option key={ext.id} value={ext.id}>
                  {ext.date ? new Date(ext.date).toLocaleDateString() : ext.id} — {ext.status.toUpperCase()}
                  {ext.floodExtent !== undefined ? ` (${(ext.floodExtent * 100).toFixed(0)}%)` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Opacity */}
          <OpacitySlider
            value={config.sentinel.opacity}
            onChange={(v) => actions.setSentinel({ opacity: v })}
          />

          {/* Status indicator for selected date */}
          {selectedExt && (() => {
            const color =
              selectedExt.status === "critical" ? "text-red-400 border-red-500/30 bg-red-500/10" :
              selectedExt.status === "warning"  ? "text-orange-400 border-orange-500/30 bg-orange-500/10" :
              "text-green-400 border-green-500/30 bg-green-500/10"
            return (
              <div className={`rounded border px-2 py-1.5 ${color}`}>
                <p className="text-[10px] font-medium">
                  {selectedExt.status.toUpperCase()} — {selectedExt.floodAreaHa.toFixed(1)} ha flooded
                </p>
                {selectedExt.floodExtent !== undefined && (
                  <p className="text-[9px] opacity-80">
                    Flood extent: {(selectedExt.floodExtent * 100).toFixed(1)}% | Soil saturation: {(selectedExt.soilSaturation * 100).toFixed(0)}%
                    {selectedExt.wetnessTrend !== null && (
                      <> | Trend: {selectedExt.wetnessTrend === 1 ? "Wetting" : selectedExt.wetnessTrend === -1 ? "Drying" : "Stable"}</>
                    )}
                  </p>
                )}
                <p className="text-[8px] opacity-60">{dataSource === "gee-csv" ? "Source: Google Earth Engine" : "Source: Mock simulation"}</p>
              </div>
            )
          })()}

          {/* Zone legend */}
          <div className="space-y-0.5">
            <p className="text-[9px] text-muted-foreground font-medium">Zone Legend</p>
            <div className="flex gap-2">
              {[
                { color: "bg-red-600",    label: "Zone A – Dike" },
                { color: "bg-orange-600", label: "Zone B – Residential" },
                { color: "bg-amber-500",  label: "Zone C – Fields" },
              ].map((z) => (
                <div key={z.label} className="flex items-center gap-1">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${z.color}`} />
                  <span className="text-[8px] text-muted-foreground">{z.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function MapControls({ config, actions, rainViewer, himawariAnimation, himawariHook, defaultCollapsed }: MapControlsProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false)
  // Compute night status client-side only to prevent SSR/hydration mismatch
  const [isNight, setIsNight] = useState(false)
  useEffect(() => {
    setIsNight(isNightInPhilippines())
  }, [])

  const baseMapOptions: { key: BaseMapStyle; label: string }[] = [
    { key: "satellite", label: "Satellite" },
    { key: "dark", label: "Dark" },
    { key: "streets", label: "Streets" },
    { key: "outdoors", label: "Terrain" },
  ]

  // RainViewer derived state
  const rvFrame = rainViewer?.frames[rainViewer.currentFrameIndex]
  const rvStatus: "online" | "loading" | "error" =
    rainViewer?.loading ? "loading" :
    rainViewer?.error ? "error" : "online"

  return (
    <Card className="border-0 shadow-none bg-transparent">
      <CardHeader className="pb-2 px-0 pt-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-5 w-5" />
            Map Layers
          </CardTitle>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? "Expand" : "Collapse"}
            {collapsed ? <ChevronDown className="h-3 w-3 inline ml-1" /> : <ChevronUp className="h-3 w-3 inline ml-1" />}
          </button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-4 pt-0 px-0 pb-0">

          {/* ═══ BASE MAP ═══════════════════════════════════════════ */}
          <Section title="Base Map">
            <div className="grid grid-cols-4 gap-1">
              {baseMapOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => actions.setBaseMap(opt.key)}
                  className={`text-[10px] rounded-md border px-1.5 py-1.5 transition-colors ${
                    config.baseMap === opt.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 border-border hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Section>

          {/* ═══ DISPLAY TOGGLES ═══════════════════════════════════ */}
          <Section title="Display">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={actions.toggleFloodZones}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                  config.showFloodZones
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-muted/40 border-border text-muted-foreground"
                }`}
              >
                {config.showFloodZones ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                Flood Zones
              </button>
              <button
                onClick={actions.toggleSensorMarkers}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                  config.showSensorMarkers
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-muted/40 border-border text-muted-foreground"
                }`}
              >
                {config.showSensorMarkers ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                Sensors
              </button>
            </div>
          </Section>

          {/* ═══ HIMAWARI SATELLITE ════════════════════════════════ */}
          <div className="rounded-md border p-2.5 space-y-2">
            <LayerToggle
              label="Himawari Satellite"
              icon={<Satellite className="h-4 w-4" />}
              enabled={config.himawari.enabled}
              onToggle={() => actions.setHimawari({ enabled: !config.himawari.enabled })}
              status="online"
              badge="NASA"
              accentColor="text-blue-400"
            />

            <p className="text-[10px] text-muted-foreground leading-tight">
              NASA GIBS — Free, no API key. Data delayed 3–5 hours.
            </p>

            {config.himawari.enabled && (
              <div className="space-y-2 pt-0.5">
                {/* Product — with night warning for Visible */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-12 shrink-0">Product</Label>
                  <div className="flex gap-1 flex-1">
                    {(["infrared", "visible"] as const).map((p) => {
                      const nightActive = p === "visible" && isNight
                      return (
                        <button
                          key={p}
                          disabled={nightActive}
                          onClick={() => {
                            if (!nightActive) actions.setHimawari({ product: p })
                          }}
                          title={nightActive ? "Visible imagery is dark at night — use Infrared" : undefined}
                          className={`relative flex-1 text-[10px] rounded border px-2 py-0.5 transition-colors capitalize ${
                            nightActive
                              ? "opacity-40 cursor-not-allowed border-border"
                              : config.himawari.product === p
                                ? "bg-blue-500 text-white border-blue-500"
                                : "bg-muted/40 border-border hover:bg-muted"
                          }`}
                        >
                          {p}
                          {nightActive && (
                            <span className="absolute -top-1.5 -right-1.5 text-[7px] bg-amber-500 text-black font-bold rounded px-0.5 leading-tight">
                              Night
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Night warning when Visible is currently selected */}
                {config.himawari.product === "visible" && isNight && (
                  <div className="flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
                    <Moon className="h-3 w-3 text-amber-400 shrink-0" />
                    <p className="text-[9px] text-amber-300 leading-tight">
                      It&apos;s nighttime in the Philippines — Visible imagery will appear dark.
                      Switching to <strong>Infrared</strong>…
                    </p>
                  </div>
                )}

                {/* Opacity */}
                <OpacitySlider
                  value={config.himawari.opacity}
                  onChange={(v) => actions.setHimawari({ opacity: v })}
                />

                {/* Animation controls (24h playback at 10-min intervals) */}
                {himawariAnimation && himawariHook && himawariAnimation.frames.length > 0 && (
                  <>
                    <TimeScrubber
                      currentIndex={himawariAnimation.currentIndex}
                      totalFrames={himawariAnimation.frames.length}
                      nowIndex={himawariAnimation.frames.length - 1}
                      timeLabel={himawariAnimation.frames[himawariAnimation.currentIndex]?.label ?? "—"}
                      relativeLabel={himawariHook.relativeLabel}
                      isForecast={false}
                      onIndexChange={(i) => himawariHook.setFrameIndex(i)}
                      onStepBack={() => himawariHook.prevFrame()}
                      onStepForward={() => himawariHook.nextFrame()}
                      accentClass="accent-blue-400"
                    />

                    <AnimationControls
                      playing={config.himawari.animating}
                      speed={config.himawari.animationSpeed}
                      onTogglePlay={() => actions.setHimawari({ animating: !config.himawari.animating })}
                      onSetSpeed={(ms) => actions.setHimawari({ animationSpeed: ms })}
                      onPrev={() => himawariHook.prevFrame()}
                      onNext={() => himawariHook.nextFrame()}
                      onJumpBack={() => {
                        const prev = Math.max(0, himawariAnimation.currentIndex - 6)
                        himawariHook.setFrameIndex(prev)
                      }}
                      onJumpForward={() => {
                        const next = Math.min(himawariAnimation.frames.length - 1, himawariAnimation.currentIndex + 6)
                        himawariHook.setFrameIndex(next)
                      }}
                      onJumpToLatest={() => himawariHook.jumpToLatest()}
                      accentBg="bg-blue-500"
                      accentBorder="border-blue-500"
                    />
                  </>
                )}

                <p className="text-[9px] text-amber-400/80 leading-tight">
                  Hourly satellite imagery (24h). 3-5 hour delay. Max zoom 6-7.
                </p>
              </div>
            )}
          </div>

          {/* ═══ RAINVIEWER RADAR ══════════════════════════════════ */}
          <div className="rounded-md border p-2.5 space-y-2">
            <LayerToggle
              label="RainViewer Radar"
              icon={<CloudRain className="h-4 w-4" />}
              enabled={config.rainViewer.enabled}
              onToggle={() => actions.setRainViewer({ enabled: !config.rainViewer.enabled })}
              status={config.rainViewer.enabled ? rvStatus : "none"}
              badge="Free"
              accentColor="text-cyan-400"
            />

            <p className="text-[10px] text-muted-foreground leading-tight">
              Real-time precipitation radar. 10-minute refresh. Covers Philippines & SE Asia.
            </p>

            {config.rainViewer.enabled && (
              <div className="space-y-2 pt-0.5">
                {/* Error state with retry */}
                {rainViewer?.error && (
                  <div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-red-300 truncate">{rainViewer.error}</p>
                      <p className="text-[9px] text-muted-foreground">Fallback: Use Himawari infrared for storm systems</p>
                    </div>
                    <button
                      onClick={rainViewer.retry}
                      className="shrink-0 text-[10px] rounded border border-border px-1.5 py-0.5 hover:bg-muted flex items-center gap-1"
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                      Retry
                    </button>
                  </div>
                )}

                {/* Loading state */}
                {rainViewer?.loading && !rainViewer?.error && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="h-3 w-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    <span className="text-[10px] text-muted-foreground">Loading radar frames…</span>
                  </div>
                )}

                {/* Frame controls — only when data is available */}
                {rainViewer && rainViewer.frames.length > 0 && (
                  <>
                    {/* Time scrubber */}
                    <TimeScrubber
                      currentIndex={rainViewer.currentFrameIndex}
                      totalFrames={rainViewer.frames.length}
                      nowIndex={rainViewer.nowIndex}
                      timeLabel={rvFrame ? rainViewer.formatTime(rvFrame) : "—"}
                      relativeLabel={rvFrame ? rainViewer.formatRelative(rvFrame) : undefined}
                      isForecast={rainViewer.currentFrameIndex > rainViewer.nowIndex}
                      onIndexChange={rainViewer.setFrameIndex}
                      onStepBack={rainViewer.prevFrame}
                      onStepForward={rainViewer.nextFrame}
                      accentClass="accent-cyan-400"
                    />

                    {/* Animation controls */}
                    <AnimationControls
                      playing={config.rainViewer.animating}
                      speed={config.rainViewer.animationSpeed}
                      onTogglePlay={() => actions.setRainViewer({ animating: !config.rainViewer.animating })}
                      onSetSpeed={(ms) => actions.setRainViewer({ animationSpeed: ms })}
                      onPrev={rainViewer.prevFrame}
                      onNext={rainViewer.nextFrame}
                      onJumpBack={() => rainViewer.setFrameIndex(Math.max(0, rainViewer.currentFrameIndex - 6))}
                      onJumpForward={() => rainViewer.setFrameIndex(Math.min(rainViewer.frames.length - 1, rainViewer.currentFrameIndex + 6))}
                      onJumpToLatest={rainViewer.jumpToLatest}
                      accentBg="bg-cyan-500"
                      accentBorder="border-cyan-500"
                    />
                  </>
                )}

                {/* Waiting for frames */}
                {rainViewer && !rainViewer.loading && !rainViewer.error && rainViewer.frames.length === 0 && (
                  <p className="text-[9px] text-muted-foreground/70 italic">
                    No radar frames available yet. Scrubber + playback controls will appear once data loads.
                  </p>
                )}

                {/* Opacity */}
                <OpacitySlider
                  value={config.rainViewer.opacity}
                  onChange={(v) => actions.setRainViewer({ opacity: v })}
                />

                {/* Color scheme */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-12 shrink-0">
                    <Palette className="h-3 w-3 inline mr-0.5" />
                    Color
                  </Label>
                  <div className="grid grid-cols-4 gap-1 flex-1">
                    {([
                      { scheme: 1, label: "Original", swatch: "bg-gradient-to-r from-green-400 to-red-500" },
                      { scheme: 2, label: "Universal", swatch: "bg-gradient-to-r from-blue-300 to-blue-700" },
                      { scheme: 6, label: "NEXRAD", swatch: "bg-gradient-to-r from-cyan-300 to-red-600" },
                      { scheme: 7, label: "Rainbow", swatch: "bg-gradient-to-r from-violet-400 to-red-500" },
                    ] as const).map(({ scheme, label, swatch }) => (
                      <button
                        key={scheme}
                        onClick={() => actions.setRainViewer({ colorScheme: scheme })}
                        className={`text-[8px] rounded border px-0.5 py-1 transition-colors text-center ${
                          config.rainViewer.colorScheme === scheme
                            ? "border-cyan-400 ring-1 ring-cyan-400/50"
                            : "border-border hover:bg-muted"
                        }`}
                        title={label}
                      >
                        <div className={`h-1.5 rounded-full mb-0.5 ${swatch}`} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Options */}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => actions.setRainViewer({ smooth: !config.rainViewer.smooth })}
                    className={`flex-1 text-[9px] rounded border px-1.5 py-1 transition-colors ${
                      config.rainViewer.smooth
                        ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Smooth
                  </button>
                  <button
                    onClick={() => actions.setRainViewer({ snow: !config.rainViewer.snow })}
                    className={`flex-1 text-[9px] rounded border px-1.5 py-1 transition-colors ${
                      config.rainViewer.snow
                        ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Snow
                  </button>
                </div>

                {/* Rain intensity legend */}
                <RainLegend visible={true} />

                {/* Last updated */}
                {rainViewer?.lastUpdated && (
                  <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                    <span>Auto-refresh: every 10 min</span>
                    <span>Updated: {new Date(rainViewer.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ═══ SENTINEL-1 FLOOD EXTENT ══════════════════════════ */}
          <SentinelSection config={config} actions={actions} />

          {/* ═══ MAP OVERLAYS (Zoom Earth style) ══════════════════ */}
          <Section title="Map Overlays">
            <div className="space-y-0.5">
              <LayerToggle
                label="Map Labels"
                icon={<Tag className="h-3.5 w-3.5" />}
                enabled={config.overlays.mapLabels}
                onToggle={() => actions.setOverlays({ mapLabels: !config.overlays.mapLabels })}
              />
              <LayerToggle
                label="Border Lines"
                icon={<Globe className="h-3.5 w-3.5" />}
                enabled={config.overlays.borderLines}
                onToggle={() => actions.setOverlays({ borderLines: !config.overlays.borderLines })}
              />
              <LayerToggle
                label="Night Boundary"
                icon={<Moon className="h-3.5 w-3.5" />}
                enabled={config.overlays.nightBoundary}
                onToggle={() => actions.setOverlays({ nightBoundary: !config.overlays.nightBoundary })}
              />
              <LayerToggle
                label="Crosshair"
                icon={<Crosshair className="h-3.5 w-3.5" />}
                enabled={config.overlays.crosshair}
                onToggle={() => actions.setOverlays({ crosshair: !config.overlays.crosshair })}
              />
            </div>
          </Section>

        </CardContent>
      )}
    </Card>
  )
}
