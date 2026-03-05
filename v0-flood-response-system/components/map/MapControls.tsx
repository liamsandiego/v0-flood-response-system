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
  RefreshCw, Tag, Globe, Moon, Crosshair, MapPin,
} from "lucide-react"
import type { MapLayerConfig, MapLayerActions, BaseMapStyle } from "@/lib/map-types"
import type { UseRainViewerReturn } from "@/hooks/use-rainviewer"
import { TimeScrubber } from "./TimeScrubber"
import { AnimationControls } from "./AnimationControls"
import { RainLegend } from "./Legend"
import { LayerToggle } from "./LayerToggle"
import { mockFloodExtents } from "@/lib/sentinel-mock-data"

// Philippines is UTC+8.
// "Night" ≈ 18:00–06:00 local time → Himawari Visible shows near-black image.
// Uses UTC arithmetic to avoid toLocaleString/timezone ICU issues on Windows Node.
function isNightInPhilippines(): boolean {
  const phHour = (new Date().getUTCHours() + 8) % 24
  return phHour >= 18 || phHour < 6
}

interface MapControlsProps {
  config: MapLayerConfig
  actions: MapLayerActions
  rainViewer?: UseRainViewerReturn
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
// Main Component
// ---------------------------------------------------------------------------
export function MapControls({ config, actions, rainViewer, defaultCollapsed }: MapControlsProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false)
  // Compute night status client-side only to prevent SSR/hydration mismatch
  const [isNight, setIsNight] = useState(false)
  useEffect(() => {
    setIsNight(isNightInPhilippines())
  }, [])

  const baseMapOptions: { key: BaseMapStyle; label: string }[] = [
    { key: "esri-satellite", label: "Satellite" },
    { key: "esri-dark", label: "Dark" },
    { key: "carto-dark", label: "CartoDB" },
    { key: "osm", label: "OSM" },
  ]

  // RainViewer derived state
  const rvFrame = rainViewer?.frames[rainViewer.currentFrameIndex]
  const rvStatus: "online" | "loading" | "error" =
    rainViewer?.loading ? "loading" :
    rainViewer?.error ? "error" : "online"

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
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
        <CardContent className="space-y-4 pt-0">

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

                {/* Date + step buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const d = new Date(config.himawari.time)
                      d.setDate(d.getDate() - 1)
                      actions.setHimawari({ time: d.toISOString().slice(0, 10) })
                    }}
                    className="text-[10px] rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                  >
                    ← 1d
                  </button>
                  <input
                    type="date"
                    value={config.himawari.time}
                    onChange={(e) => actions.setHimawari({ time: e.target.value })}
                    max={new Date().toISOString().slice(0, 10)}
                    className="flex-1 text-[10px] rounded border border-border bg-background px-1.5 py-0.5"
                  />
                  <button
                    onClick={() => {
                      const d = new Date(config.himawari.time)
                      d.setDate(d.getDate() + 1)
                      const max = new Date().toISOString().slice(0, 10)
                      const next = d.toISOString().slice(0, 10)
                      if (next <= max) actions.setHimawari({ time: next })
                    }}
                    className="text-[10px] rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                  >
                    1d →
                  </button>
                </div>

                {/* Quick offsets */}
                <div className="flex gap-1">
                  {[
                    { label: "−24h", offset: -24 },
                    { label: "−12h", offset: -12 },
                    { label: "−4h", offset: -4 },
                    { label: "Now*", offset: -4 },
                  ].map(({ label, offset }) => (
                    <button
                      key={label}
                      onClick={() => {
                        const d = new Date(Date.now() + offset * 3600000)
                        actions.setHimawari({ time: d.toISOString().slice(0, 10) })
                      }}
                      className="flex-1 text-[9px] rounded border border-border px-0.5 py-0.5 hover:bg-muted transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p className="text-[9px] text-amber-400/80 leading-tight">
                  ⚠ 3–5 hour delay from real-time. Max zoom level 8.
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
          <div className="rounded-md border p-2.5 space-y-2">
            <LayerToggle
              label="Sentinel-1 Flood Extent"
              icon={<Radio className="h-4 w-4" />}
              enabled={config.sentinel.enabled}
              onToggle={() => {
                const willEnable = !config.sentinel.enabled
                // Auto-select latest acquisition when enabling so polygons appear immediately
                if (willEnable && !config.sentinel.acquisitionDate) {
                  const latest = mockFloodExtents[mockFloodExtents.length - 1]
                  actions.setSentinel({ enabled: true, acquisitionDate: latest?.id ?? null })
                } else {
                  actions.setSentinel({ enabled: willEnable })
                }
              }}
              badge="Simulated"
              accentColor="text-orange-400"
            />

            <p className="text-[10px] text-muted-foreground leading-tight">
              SAR-derived flood extent simulation for Obando, Bulacan. 3 acquisition dates.
            </p>

            {config.sentinel.enabled && (
              <div className="space-y-2 pt-0.5">
                {/* Date selector */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-12 shrink-0">Date</Label>
                  <select
                    value={config.sentinel.acquisitionDate ?? ""}
                    onChange={(e) =>
                      actions.setSentinel({ acquisitionDate: e.target.value || null })
                    }
                    className="flex-1 text-[10px] rounded border border-border bg-background px-1.5 py-1"
                  >
                    <option value="">Select acquisition…</option>
                    {mockFloodExtents.map((ext) => (
                      <option key={ext.id} value={ext.id}>
                        {new Date(ext.date).toLocaleDateString()} — {ext.status.toUpperCase()}
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
                {config.sentinel.acquisitionDate && (() => {
                  const ext = mockFloodExtents.find((e) => e.id === config.sentinel.acquisitionDate)
                  if (!ext) return null
                  const color =
                    ext.status === "critical" ? "text-red-400 border-red-500/30 bg-red-500/10" :
                    ext.status === "warning"  ? "text-orange-400 border-orange-500/30 bg-orange-500/10" :
                    "text-green-400 border-green-500/30 bg-green-500/10"
                  return (
                    <div className={`rounded border px-2 py-1.5 ${color}`}>
                      <p className="text-[10px] font-medium">
                        {ext.status.toUpperCase()} — {ext.floodAreaHa.toFixed(1)} ha flooded
                      </p>
                      <p className="text-[9px] opacity-80">{ext.description}</p>
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
