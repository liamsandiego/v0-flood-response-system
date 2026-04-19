"use client"

// =============================================================================
// RapidRelay – Map Controls Panel (v2)
//
// Full-featured control panel:
//   - Base map selector
//   - Display toggles (Flood Zones, Sensors)
//   - Himawari Satellite (infrared, opacity, animation)
//   - Map Overlays (labels, borders, crosshair)
//
// Collapsible sections for mobile-friendly usage.
// =============================================================================

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Layers, Satellite, Eye, EyeOff,
  ChevronDown, ChevronUp, Tag, Globe, Crosshair, Maximize,
} from "lucide-react"
import type { MapLayerConfig, MapLayerActions, BaseMapStyle } from "@/lib/map-types"
import type { UseHimawariReturn, HimawariFrame } from "@/hooks/use-himawari"
import { useFloodStore } from "@/stores/sensorStore"
import { AnimationControls } from "./AnimationControls"
import { LayerToggle } from "./LayerToggle"

/** Himawari animation state passed from AppShell */
export interface HimawariAnimationData {
  frames: HimawariFrame[]   // array of { time, label, url } objects
  currentIndex: number       // current frame index
}

interface MapControlsProps {
  config: MapLayerConfig
  actions: MapLayerActions
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
// Unit Toggle Component
// ---------------------------------------------------------------------------
function UnitToggle() {
  const unit = useFloodStore((s) => s.unit)
  const setUnit = useFloodStore((s) => s.setUnit)

  return (
    <div className="flex items-center gap-2">
      <Label className="text-[10px] text-muted-foreground flex-1">Units</Label>
      <div className="flex gap-1">
        <button
          onClick={() => setUnit("metric")}
          className={`text-[10px] rounded border px-2 py-1 transition-colors ${
            unit === "metric"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/40 border-border hover:bg-muted"
          }`}
        >
          Meters
        </button>
        <button
          onClick={() => setUnit("imperial")}
          className={`text-[10px] rounded border px-2 py-1 transition-colors ${
            unit === "imperial"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/40 border-border hover:bg-muted"
          }`}
        >
          Feet
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recenter Button Component
// ---------------------------------------------------------------------------
function RecenterButton() {
  const handleRecenter = () => {
    // Recenter on Obando flood zone (from DEPLOYMENT in constants)
    const obandoCenter = {
      lat: 14.7094,
      lng: 120.9358,
      zoom: 15,
    };

    window.dispatchEvent(
      new CustomEvent("map:flyTo", {
        detail: obandoCenter,
      })
    )
  }

  return (
    <button
      onClick={handleRecenter}
      className="w-full flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors bg-muted/40 border-border hover:bg-muted text-muted-foreground"
    >
      <Maximize className="h-3 w-3" />
      Recenter on Flood Zone
    </button>
  )
}



// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function MapControls({ config, actions, himawariAnimation, himawariHook, defaultCollapsed }: MapControlsProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false)

  const baseMapOptions: { key: BaseMapStyle; label: string }[] = [
    { key: "satellite", label: "Satellite" },
    { key: "dark", label: "Dark" },
    { key: "streets", label: "Streets" },
    { key: "outdoors", label: "Terrain" },
  ]

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

          {/* ═══ SETTINGS (Units, Recenter) ════════════════════════ */}
          <Section title="Settings">
            <UnitToggle />
            <RecenterButton />
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
              NASA GIBS Infrared — Works day/night. 3-5h delay. Coverage is Asia-Pacific only.
            </p>

            {config.himawari.enabled && (
              <div className="space-y-2 pt-0.5">
                {/* Opacity */}
                <OpacitySlider
                  value={config.himawari.opacity}
                  onChange={(v) => actions.setHimawari({ opacity: v })}
                />

                {/* Animation controls (24h playback) */}
                {himawariAnimation && himawariHook && himawariAnimation.frames.length > 0 && (
                  <div className="space-y-2">
                    {/* Time display */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-medium">
                        {himawariAnimation.frames[himawariAnimation.currentIndex]?.label ?? "—"}
                      </span>
                      <span className="text-muted-foreground">
                        {himawariAnimation.currentIndex + 1}/{himawariAnimation.frames.length}
                      </span>
                    </div>

                    {/* Slider */}
                    <input
                      type="range"
                      min={0}
                      max={himawariAnimation.frames.length - 1}
                      value={himawariAnimation.currentIndex}
                      onChange={(e) => himawariHook.setFrameIndex(Number(e.target.value))}
                      className="w-full h-1.5 accent-blue-400 cursor-pointer"
                      style={{ touchAction: "none" }}
                    />

                    {/* Playback controls */}
                    <AnimationControls
                      playing={config.himawari.animating}
                      speed={config.himawari.animationSpeed}
                      onTogglePlay={() => actions.setHimawari({ animating: !config.himawari.animating })}
                      onSetSpeed={(ms) => actions.setHimawari({ animationSpeed: ms })}
                      onPrev={() => himawariHook.prevFrame()}
                      onNext={() => himawariHook.nextFrame()}
                      onJumpToLatest={() => himawariHook.jumpToLatest()}
                      accentBg="bg-blue-500"
                    />
                  </div>
                )}
              </div>
            )}
          </div>



          {/* ═══ MAP OVERLAYS ══════════════════════════════════════ */}
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
