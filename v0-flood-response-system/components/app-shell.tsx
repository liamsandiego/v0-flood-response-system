"use client"

// =============================================================================
// RapidRelay – App Shell
//
// Globe-as-backdrop architecture: The 3D Mapbox globe renders behind all UI
// panels. The Dashboard and all tabs float above using glassmorphism styling.
//
// Z-INDEX HIERARCHY:
//   z-0:  Mapbox 3D globe (full screen, interactive via pointer-events pass-through)
//   z-10: UI panels (floating, pointer-events-auto)
//   z-20: Modals, alerts, critical banners
//   z-30: Mobile layers modal overlay
// =============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import dynamic from "next/dynamic"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorBoundary } from "@/components/error-boundary"
import { MapErrorBoundary } from "@/components/globe/GlobeMap"
import AIInterpretationPanel from "@/components/panels/AIInterpretationPanel"
import { SensorGraphs } from "@/components/sensor-graphs"
import { EvacuationTips } from "@/components/evacuation-tips"
import { SmsBroadcastLog } from "@/components/sms-broadcast-log"
import { DataTab } from "@/components/data-tab"
import { AlertHistory } from "@/components/alert-history"
import { AlertControls } from "@/components/alert-controls"
import { PwaInstallButton } from "@/components/pwa-install-button"
import { NotificationButton } from "@/components/notification-button"
import { MapControls } from "@/components/map/MapControls"
import {
  Droplets, Waves, ThermometerSun, Clock, Radio,
  LogOut, User, ShieldAlert, Activity,
  AlertTriangle, CloudRain, Maximize, TrendingUp, TrendingDown, Minus, AlertOctagon,
  Map as MapIcon, Shield, History, Megaphone, Database, Settings,
  Layers, ChevronUp, ChevronDown, X, Navigation,
} from "lucide-react"
import { FloatingPanel } from "@/components/floating-panel"
import { useAuth } from "@/components/auth-provider"
import { useNotifications } from "@/hooks/use-notifications"
import { usePersistentAlerts } from "@/hooks/use-persistent-alerts"
import { useMapLayers } from "@/hooks/use-map-layers"
import { useRainViewer } from "@/hooks/use-rainviewer"
import { useHimawari } from "@/hooks/use-himawari"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime"
import { useSupabaseHistory } from "@/hooks/useSupabaseHistory"
import { useFloodStore } from "@/stores/sensorStore"
import { formatSensorValue } from "@/lib/conversion"
import { isSensorOnline, getConsecutiveFailures } from "@/lib/sensor-validation"
import { evaluateSnapshot, evaluateSensorHealth } from "@/lib/alert-engine"
import { DEPLOYMENT, SENSOR_REGISTRY, SENSOR_POLL_INTERVAL_MS, ALL_SENSOR_IDS } from "@/lib/constants"
import { buildSnapshotFromStore } from "@/lib/sensor-utils"
import type { SensorSnapshot, AlertLevel, SensorReading } from "@/lib/types"
import type { UserRole } from "@/components/auth-provider"

// Lazy-load the globe (needs browser APIs)
const GlobeMap = dynamic(() => import("@/components/globe/GlobeMap"), { ssr: false })

// =============================================================================
// Glass Panel Wrapper — Reusable glassmorphism container
// =============================================================================

function GlassPanel({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`backdrop-blur-xl bg-slate-900/60 border border-white/10 rounded-xl shadow-2xl text-white ${className}`}
    >
      {children}
    </div>
  )
}

// =============================================================================
// Glass Card — Replaces shadcn Card for sensor cards over the globe
// =============================================================================

function GlassCard({
  children,
  className = "",
  flash = false,
  critical = false,
}: {
  children: React.ReactNode
  className?: string
  flash?: boolean
  critical?: boolean
}) {
  return (
    <div
      className={`
        backdrop-blur-xl border rounded-xl p-4 transition-all duration-500
        ${critical
          ? "bg-red-950/60 border-red-500/40 shadow-lg shadow-red-500/10"
          : "bg-slate-900/60 border-white/10"
        }
        ${flash ? "ring-2 ring-cyan-400/50 shadow-lg scale-[1.02]" : ""}
        text-white
        ${className}
      `}
    >
      {children}
    </div>
  )
}

// =============================================================================
// Tab definitions
// =============================================================================
type TabId = "map" | "safety" | "history" | "broadcasts" | "data" | "controls"

const TABS: { id: TabId; label: string; icon: React.ReactNode; iconTouch: React.ReactNode }[] = [
  { id: "map", label: "Map", icon: <MapIcon className="h-4 w-4" />, iconTouch: <MapIcon className="h-6 w-6" /> },
  { id: "safety", label: "Safety", icon: <Shield className="h-4 w-4" />, iconTouch: <Shield className="h-6 w-6" /> },
  { id: "history", label: "History", icon: <History className="h-4 w-4" />, iconTouch: <History className="h-6 w-6" /> },
  { id: "broadcasts", label: "Alerts", icon: <Megaphone className="h-4 w-4" />, iconTouch: <Megaphone className="h-6 w-6" /> },
  { id: "data", label: "Data", icon: <Database className="h-4 w-4" />, iconTouch: <Database className="h-6 w-6" /> },
  { id: "controls", label: "Controls", icon: <Settings className="h-4 w-4" />, iconTouch: <Settings className="h-6 w-6" /> },
]

// =============================================================================
// Main App Shell Component
// =============================================================================

export default function AppShell() {
  const { user, logout } = useAuth()
  const { sendNotification } = useNotifications()
  const { alerts, addAlerts, acknowledgeAlert, clearAll } = usePersistentAlerts()
  const { layers, actions: layerActions } = useMapLayers()
  const rainViewer = useRainViewer()
  const himawari = useHimawari(
    layers.himawari.product,
    layers.himawari.enabled,
    layers.himawari.animating,
    layers.himawari.animationSpeed
  )
  const { send: wsSend } = useWebSocket()
  useSupabaseRealtime()  // Fallback: subscribes to Supabase when WebSocket is down
  const wsStatus = useFloodStore((s) => s.wsStatus)
  const sensorData = useFloodStore((s) => s.sensorData)
  const prediction = useFloodStore((s) => s.prediction)
  const sensorHistory = useFloodStore((s) => s.sensorHistory)

  const [activeTab, setActiveTab] = useState<TabId>("map")
  const [snapshot, setSnapshot] = useState<SensorSnapshot | null>(null)
  const [history, setHistory] = useState<SensorSnapshot[]>([])
  useSupabaseHistory(setHistory)
  const [flashSensor, setFlashSensor] = useState<string | null>(null)
  const [networkOnline, setNetworkOnline] = useState(true)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true)

  // Mobile-specific state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false)
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false)

  // Touch device detection — forces mobile layout on all touch devices
  // regardless of screen width (tablets in landscape are often >1024px)
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    setIsTouch(navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  }, [])

  const startTime = useRef(Date.now())
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Stable refs for callbacks
  const addAlertsRef = useRef(addAlerts)
  addAlertsRef.current = addAlerts
  const sendNotificationRef = useRef(sendNotification)
  sendNotificationRef.current = sendNotification

  // ── RainViewer animation loop ──
  useEffect(() => {
    if (!layers.rainViewer.enabled || !layers.rainViewer.animating) return
    if (rainViewer.frames.length === 0) return
    const interval = setInterval(() => {
      rainViewer.nextFrame()
    }, layers.rainViewer.animationSpeed)
    return () => clearInterval(interval)
  }, [layers.rainViewer.enabled, layers.rainViewer.animating, layers.rainViewer.animationSpeed, rainViewer.frames.length, rainViewer.nextFrame])

  // ── RainViewer tile URLs for Zoom Earth pattern (all frames mounted) ──
  const rainViewerTileUrls = useMemo(() => {
    if (!layers.rainViewer.enabled || rainViewer.frames.length === 0) return []
    return rainViewer.frames.map((frame) =>
      rainViewer.getTileUrl(
        frame,
        layers.rainViewer.colorScheme,
        layers.rainViewer.smooth,
        layers.rainViewer.snow
      )
    )
  }, [
    layers.rainViewer.enabled,
    rainViewer.frames,
    rainViewer.getTileUrl,
    layers.rainViewer.colorScheme,
    layers.rainViewer.smooth,
    layers.rainViewer.snow,
  ])

  // ── Himawari animation data for MapControls ──
  const himawariAnimationData = useMemo(() => ({
    frames: himawari.frames,
    currentIndex: himawari.activeIndex,
  }), [himawari.frames, himawari.activeIndex])

  // ── Network status ──
  useEffect(() => {
    const onOnline = () => setNetworkOnline(true)
    const onOffline = () => setNetworkOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    setNetworkOnline(navigator.onLine)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  // ── Siren audio ──
  useEffect(() => {
    if (snapshot?.overallStatus === "critical") {
      if (audioRef.current) {
        audioRef.current.loop = true
        audioRef.current.play().catch(() => {})
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [snapshot?.overallStatus])

  // ── Build snapshot from real WebSocket data in Zustand store ──
  useEffect(() => {
    let flashTimeout: ReturnType<typeof setTimeout> | null = null
    let mounted = true

    const tick = () => {
      if (!mounted) return

      // Build snapshot from real store data
      const snap = buildSnapshotFromStore(sensorData, prediction, sensorHistory)
      if (!snap) return // No data yet — keep showing waiting state

      setSnapshot(snap)
      setHistory((prev) => [...prev.slice(-143), snap])

      if (flashTimeout) clearTimeout(flashTimeout)
      setFlashSensor("all")
      flashTimeout = setTimeout(() => {
        if (mounted) setFlashSensor(null)
      }, 800)

      // Evaluate alerts from real data
      try {
        const thresholdAlerts = evaluateSnapshot(snap)
        const healthAlerts = evaluateSensorHealth(snap)
        const newAlerts = [...thresholdAlerts, ...healthAlerts]

        if (newAlerts.length > 0) {
          addAlertsRef.current(newAlerts)
          for (const a of newAlerts) {
            sendNotificationRef.current(a.title, a.message, a.level)
          }
        }
      } catch (err) {
        console.error("[AppShell] Alert evaluation error:", err)
      }
    }

    tick()
    const interval = setInterval(tick, SENSOR_POLL_INTERVAL_MS)
    return () => {
      mounted = false
      clearInterval(interval)
      if (flashTimeout) clearTimeout(flashTimeout)
    }
  }, [sensorData, prediction, sensorHistory])

  // ── Helpers ──
  const getStatusColor = (status: AlertLevel) => {
    switch (status) {
      case "critical": return "bg-red-500 text-white"
      case "warning": return "bg-yellow-500 text-black"
      default: return "bg-emerald-500 text-white"
    }
  }

  const getStatusText = (status: AlertLevel) => {
    switch (status) {
      case "critical": return "CRITICAL ALERT"
      case "warning": return "WARNING"
      default: return "NORMAL"
    }
  }

  const getSensorIcon = (sensorId: string) => {
    switch (sensorId) {
      case "ultrasonic_water_level": return <Waves className="h-4 w-4 text-blue-400" />
      case "capacitive_soil_moisture": return <Droplets className="h-4 w-4 text-amber-400" />
      case "humidity_dht22": return <ThermometerSun className="h-4 w-4 text-teal-400" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const overallStatus = snapshot?.overallStatus ?? "normal"
  const uptime = Math.floor((Date.now() - startTime.current) / 1000)
  const uptimeStr =
    uptime < 60 ? `${uptime}s` :
      uptime < 3600 ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` :
        `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
  const unackCritical = alerts.filter((a) => !a.acknowledged && a.level === "critical").length

  // ── Sensor card renderer ──
  const renderSensorCard = (sensorId: string) => {
    if (!snapshot) return null
    if (sensorId !== "ultrasonic_water_level" && sensorId !== "capacitive_soil_moisture" && sensorId !== "humidity_dht22") return null

    const meta = SENSOR_REGISTRY[sensorId]
    const reading =
      sensorId === "ultrasonic_water_level" ? snapshot.waterLevel :
        sensorId === "capacitive_soil_moisture" ? snapshot.soilMoisture :
          snapshot.humidity
    const online = isSensorOnline(sensorId)
    const failures = getConsecutiveFailures(sensorId)
    const isCritical = reading.status === "critical"

    return (
      <GlassCard
        key={sensorId}
        flash={flashSensor === "all"}
        critical={isCritical}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {getSensorIcon(sensorId)}
            <span className="text-sm font-semibold">{meta.shortLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            {!reading.isValid && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">FALLBACK</span>
            )}
            {!online && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">OFFLINE</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              reading.status === "critical" ? "bg-red-500/30 text-red-300" :
              reading.status === "warning" ? "bg-yellow-500/30 text-yellow-300" :
              "bg-emerald-500/30 text-emerald-300"
            }`}>
              {reading.status.toUpperCase()}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-white/50 mb-2">{meta.label}</p>
        <div className="flex items-center gap-2 mb-2">
          {getSensorIcon(sensorId)}
          <span className="text-2xl font-bold">
            {formatSensorValue(sensorId, reading.effectiveValue, "metric")}
          </span>
        </div>
        <p className="text-[11px] text-white/40 mb-1">{meta.placement}</p>
        {failures > 0 && (
          <p className="text-[11px] text-orange-400">
            {failures} consecutive invalid reading{failures > 1 ? "s" : ""}
          </p>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-white/40 mt-2">
          <Clock className="h-3 w-3" />
          <span>Updated: {reading.timestamp.toLocaleTimeString()}</span>
        </div>
      </GlassCard>
    )
  }

  // ── Sensor panel content (shared between desktop left panel + mobile bottom sheet) ──
  const renderSensorPanelContent = () => (
    <>
      {/* Waiting for sensor data */}
      {!snapshot && (
        <div className="py-8 flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          <p className="text-sm text-white/50 font-mono">Connecting to sensors...</p>
          <p className="text-[10px] text-white/30">Waiting for WebSocket data</p>
        </div>
      )}
      {/* Network warning */}
      {!networkOnline && (
        <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-2 flex items-center gap-2 text-[11px] text-yellow-300">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Network offline — cached data
        </div>
      )}

      {/* Section: Critical Status */}
      <div>
        <h2 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-red-400 uppercase tracking-wider">
          <ShieldAlert className="h-3.5 w-3.5" />
          Critical Status
        </h2>
        <div className="space-y-2">
          {renderSensorCard("ultrasonic_water_level")}

          {/* Risk Factor card */}
          {snapshot && (
            <GlassCard critical={snapshot.risk > 0.8} flash={flashSensor === "all"}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-semibold">Risk Factor</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  snapshot.risk > 0.8 ? "bg-red-500/30 text-red-300" :
                  snapshot.risk > 0.5 ? "bg-orange-500/30 text-orange-300" :
                  "bg-emerald-500/30 text-emerald-300"
                }`}>
                  {snapshot.risk > 0.8 ? "HIGH" : snapshot.risk > 0.5 ? "MEDIUM" : "LOW"}
                </span>
              </div>
              <p className="text-[11px] text-white/50 mb-2">Composite Risk Score</p>
              <div className="flex items-center gap-2 mb-2">
                <AlertOctagon className="h-4 w-4 text-red-400" />
                <span className="text-2xl font-bold">{(snapshot.risk * 100).toFixed(1)} %</span>
              </div>
              <p className="text-[11px] text-white/40 mb-1">Algo-driven Threat Level</p>
              <div className="flex items-center gap-1.5 text-[11px] text-white/40 mt-2">
                <Clock className="h-3 w-3" />
                <span>Updated: {snapshot.timestamp.toLocaleTimeString()}</span>
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Section: Environmental Conditions */}
      <div>
        <h2 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-orange-400 uppercase tracking-wider">
          <ThermometerSun className="h-3.5 w-3.5" />
          Environmental
        </h2>
        <div className="space-y-2">
          {/* Rainfall */}
          {snapshot && (
            <GlassCard flash={flashSensor === "all"}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CloudRain className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-semibold">Rainfall</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  snapshot.rainfall > 30 ? "bg-red-500/30 text-red-300" :
                  snapshot.rainfall > 7.5 ? "bg-yellow-500/30 text-yellow-300" :
                  "bg-blue-500/30 text-blue-300"
                }`}>
                  {snapshot.rainfall > 30 ? "HEAVY" : snapshot.rainfall > 7.5 ? "MODERATE" : "LIGHT"}
                </span>
              </div>
              <p className="text-[11px] text-white/50 mb-2">Precipitation Rate</p>
              <div className="flex items-center gap-2 mb-1">
                <CloudRain className="h-4 w-4 text-blue-400" />
                <span className="text-2xl font-bold">{snapshot.rainfall.toFixed(1)} mm</span>
              </div>
              <p className="text-[11px] text-white/40">Obando Station Gauge</p>
              <div className="flex items-center gap-1.5 text-[11px] text-white/40 mt-2">
                <Clock className="h-3 w-3" />
                <span>Updated: {snapshot.timestamp.toLocaleTimeString()}</span>
              </div>
            </GlassCard>
          )}

          {renderSensorCard("humidity_dht22")}
          {renderSensorCard("capacitive_soil_moisture")}
        </div>
      </div>

      {/* Section: Analysis & Trends */}
      <div>
        <h2 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-purple-400 uppercase tracking-wider">
          <Activity className="h-3.5 w-3.5" />
          Analysis
        </h2>
        <div className="space-y-2">
          {/* Flood Extent */}
          {snapshot && (
            <GlassCard flash={flashSensor === "all"}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Maximize className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-semibold">Flood Extent</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-purple-500/30 text-purple-300">
                  ESTIMATED
                </span>
              </div>
              <p className="text-[11px] text-white/50 mb-2">Area Coverage</p>
              <div className="flex items-center gap-2 mb-1">
                <Maximize className="h-4 w-4 text-purple-400" />
                <span className="text-2xl font-bold">{(snapshot.floodExtent * 100).toFixed(1)} %</span>
              </div>
              <p className="text-[11px] text-white/40">Monitored Zone Coverage</p>
            </GlassCard>
          )}

          {/* Wetness Trend */}
          {snapshot && (
            <GlassCard flash={flashSensor === "all"}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {snapshot.wetnessTrend > 0 ? <TrendingUp className="h-4 w-4 text-orange-400" /> :
                    snapshot.wetnessTrend < 0 ? <TrendingDown className="h-4 w-4 text-green-400" /> :
                      <Minus className="h-4 w-4 text-white/40" />}
                  <span className="text-sm font-semibold">Wetness Trend</span>
                </div>
              </div>
              <p className="text-[11px] text-white/50 mb-2">Saturation Direction</p>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl font-bold">
                  {snapshot.wetnessTrend > 0 ? "Rising" : snapshot.wetnessTrend < 0 ? "Falling" : "Stable"}
                </span>
              </div>
              <p className="text-[11px] text-white/40">Rate: {Math.abs(snapshot.wetnessTrend)}</p>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Section: AI Analysis */}
      <div>
        <ErrorBoundary>
          <AIInterpretationPanel />
        </ErrorBoundary>
      </div>
    </>
  )

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <div className="dark glass-dark h-screen w-screen overflow-hidden bg-slate-950 relative" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <audio ref={audioRef} src="/sounds/siren.mp3" preload="auto" />

      {/* ── Z-0: Globe Background ── */}
      <div className="absolute inset-0 z-0">
        <MapErrorBoundary>
          <GlobeMap
            isTouch={isTouch}
            layerConfig={layers}
            himawariFrames={himawari.frames}
            himawariActiveIndex={himawari.activeIndex}
            himawariMaxZoom={himawari.maxZoom}
            rainViewerTileUrls={rainViewerTileUrls}
            rainViewerActiveIndex={rainViewer.currentFrameIndex}
          />
        </MapErrorBoundary>
      </div>

      {/* ── Z-20: Critical overlay ── */}
      {overallStatus === "critical" && (
        <div
          className="absolute inset-0 z-20 pointer-events-none animate-pulse"
          style={{
            background: "radial-gradient(ellipse at center, transparent 50%, rgba(220,38,38,0.15) 100%)",
          }}
        />
      )}

      {/* ── Z-10: All UI Panels ── */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">

        {/* ═══════ HEADER ═══════ */}
        <div className="pointer-events-auto shrink-0">
          <GlassPanel className="m-2 mb-0 px-3 md:px-4 py-1.5 md:py-2 flex items-center justify-between rounded-xl overflow-hidden">
            {/* Left: Logo + title */}
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              <div className="h-7 w-7 md:h-8 md:w-8 bg-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <Droplets className="h-4 w-4 md:h-5 md:w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xs md:text-sm font-bold text-white leading-tight truncate">Rapid Relay</h1>
                <p className="text-[9px] md:text-[10px] text-white/50 truncate hidden sm:block">{DEPLOYMENT.name} — Flood Response System</p>
              </div>
            </div>
            {/* Right: Status + controls */}
            <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
              {/* WebSocket status */}
              <div className="flex items-center gap-1">
                <div className={`h-2 w-2 rounded-full ${
                  wsStatus === "connected" ? "bg-emerald-400" :
                  wsStatus === "connecting" ? "bg-yellow-400 animate-pulse" :
                  "bg-red-400"
                }`} />
                {!isTouch && (
                  <span className="text-[10px] text-white/50 hidden lg:inline">
                    {wsStatus === "connected" ? "LIVE" : wsStatus.toUpperCase()}
                  </span>
                )}
              </div>
              {/* User info — desktop only */}
              {!isTouch && (
                <div className="hidden lg:flex items-center gap-1.5 ml-2">
                  <User className="h-3.5 w-3.5 text-white/60" />
                  <span className="text-xs text-white/80 hidden sm:inline">{user?.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-300 font-bold uppercase">
                    {user?.role}
                  </span>
                </div>
              )}
              {/* PWA Install — mobile: compact icon, desktop: full button */}
              {isTouch ? (
                <PwaInstallButton compact />
              ) : (
                <div className="hidden lg:flex items-center gap-1">
                  <PwaInstallButton />
                  <NotificationButton />
                </div>
              )}
              {/* Alert badge — always visible */}
              <Badge className={`${getStatusColor(overallStatus)} text-[10px] lg:text-[10px] px-2 py-0.5`}>
                {getStatusText(overallStatus)}
              </Badge>
              {/* Logout — always visible */}
              <Button
                variant="ghost"
                size="sm"
                className={`text-white/60 hover:text-white hover:bg-white/10 px-2 ${isTouch ? "h-9" : "h-8 lg:h-7"}`}
                onClick={logout}
              >
                <LogOut className={isTouch ? "h-5 w-5" : "h-4 w-4 lg:h-3.5 lg:w-3.5"} />
              </Button>
            </div>
          </GlassPanel>
        </div>

        {/* ═══════ MAIN CONTENT AREA ═══════ */}
        {/* pb-16 on mobile = 64px clearance for fixed bottom nav; pb-8 on desktop for footer */}
        <div className="flex-1 overflow-hidden p-2 relative" style={{ paddingBottom: isTouch ? '72px' : '36px' }}>

          {/* ─── Non-map tabs: full-screen scrollable content ─── */}
          {activeTab !== "map" && (
            <div className="pointer-events-auto h-full overflow-y-auto">
              <GlassPanel className="p-4 min-h-full">
                {activeTab === "safety" && (
                  <ErrorBoundary>
                    <div className="dark glass-dark">
                      <EvacuationTips />
                    </div>
                  </ErrorBoundary>
                )}
                {activeTab === "history" && (
                  <ErrorBoundary>
                    <div className="dark glass-dark">
                      <AlertHistory
                        alerts={alerts}
                        unit="metric"
                        onAcknowledge={acknowledgeAlert}
                        onClearAll={clearAll}
                        userRole={user?.role ?? "viewer"}
                      />
                    </div>
                  </ErrorBoundary>
                )}
                {activeTab === "broadcasts" && (
                  <ErrorBoundary>
                    <div className="dark glass-dark">
                      <SmsBroadcastLog alerts={alerts} />
                    </div>
                  </ErrorBoundary>
                )}
                {activeTab === "data" && (
                  <ErrorBoundary>
                    <div className="dark glass-dark">
                      <DataTab history={history} />
                    </div>
                  </ErrorBoundary>
                )}
                {activeTab === "controls" && (
                  <ErrorBoundary>
                    {user?.role === "viewer" ? (
                      <div className="py-8 text-center text-white/60">
                        You do not have permission to access alert controls.
                      </div>
                    ) : (
                      <div className={`dark glass-dark grid gap-4 ${isTouch ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
                        <AlertControls
                          currentStatus={overallStatus}
                          userRole={user?.role ?? "viewer"}
                          snapshot={snapshot}
                        />
                        <MapControls config={layers} actions={layerActions} rainViewer={rainViewer} himawariAnimation={himawariAnimationData} himawariHook={himawari} />
                      </div>
                    )}
                  </ErrorBoundary>
                )}
              </GlassPanel>
            </div>
          )}

          {/* ═══ Map tab: Draggable floating panels (desktop) ═══ */}

          {/* LEFT — Sensor Status */}
          {activeTab === "map" && leftPanelOpen && !isTouch && (
            <FloatingPanel
              title="Sensor Status"
              icon={<ShieldAlert className="h-3.5 w-3.5 text-red-400" />}
              onClose={() => setLeftPanelOpen(false)}
              className="hidden lg:flex pointer-events-auto absolute top-0 left-0 w-[300px] flex-col max-h-[calc(100%-4px)] z-[15]"
            >
              <div className="p-3 space-y-3 overflow-y-auto scrollbar-thin flex-1">
                {renderSensorPanelContent()}
              </div>
            </FloatingPanel>
          )}

          {/* Toggle: reopen left panel */}
          {activeTab === "map" && !leftPanelOpen && !isTouch && (
            <button
              className="hidden lg:flex pointer-events-auto absolute top-1 left-0 items-center gap-1.5 px-2 py-1.5 text-[10px] text-white/50 hover:text-white bg-slate-900/50 backdrop-blur rounded-r-lg border border-white/10 border-l-0 z-[1]"
              onClick={() => setLeftPanelOpen(true)}
            >
              <ShieldAlert className="h-3 w-3" /> Status
            </button>
          )}

          {/* RIGHT — Map Layers */}
          {activeTab === "map" && rightPanelOpen && !isTouch && (
            <FloatingPanel
              title="Map Layers"
              icon={<Layers className="h-3.5 w-3.5 text-cyan-400" />}
              onClose={() => setRightPanelOpen(false)}
              className="hidden lg:flex pointer-events-auto absolute top-0 right-0 w-[300px] flex-col max-h-[calc(100%-4px)] z-[15]"
            >
              <div className="p-3 dark glass-dark overflow-y-auto scrollbar-thin flex-1">
                <ErrorBoundary>
                  <MapControls config={layers} actions={layerActions} rainViewer={rainViewer} himawariAnimation={himawariAnimationData} himawariHook={himawari} />
                </ErrorBoundary>
              </div>
            </FloatingPanel>
          )}

          {/* Toggle: reopen right panel */}
          {activeTab === "map" && !rightPanelOpen && !isTouch && (
            <button
              className="hidden lg:flex pointer-events-auto absolute top-1 right-0 items-center gap-1.5 px-2 py-1.5 text-[10px] text-white/50 hover:text-white bg-slate-900/50 backdrop-blur rounded-l-lg border border-white/10 border-r-0 z-[1]"
              onClick={() => setRightPanelOpen(true)}
            >
              <Layers className="h-3 w-3" /> Layers
            </button>
          )}

          {/* BOTTOM — Live Trends */}
          {activeTab === "map" && bottomPanelOpen && !isTouch && (
            <FloatingPanel
              title="Live Sensor Trends"
              icon={<TrendingUp className="h-3.5 w-3.5 text-blue-400" />}
              onClose={() => setBottomPanelOpen(false)}
              className="hidden lg:flex pointer-events-auto absolute bottom-[40px] left-0 right-0 flex-col z-[15]"
            >
              <div className="p-3 dark glass-dark max-h-[220px] overflow-y-auto">
                <ErrorBoundary>
                  <SensorGraphs history={history} unit="metric" />
                </ErrorBoundary>
              </div>
            </FloatingPanel>
          )}

          {/* Toggle: reopen bottom panel */}
          {activeTab === "map" && !bottomPanelOpen && !isTouch && (
            <button
              className="hidden lg:block pointer-events-auto absolute bottom-[40px] left-1/2 -translate-x-1/2 px-3 py-1 text-[10px] text-white/50 hover:text-white bg-slate-900/50 backdrop-blur rounded-t-lg border border-white/10 border-b-0 z-[1]"
              onClick={() => setBottomPanelOpen(true)}
            >
              Show Trends
            </button>
          )}
        </div>

        {/* ═══════ MOBILE: Floating Metrics Bar — sits above fixed nav ═══════ */}
        {/* Note: This is positioned outside the flex flow using z-[24] fixed positioning */}
      </div>

      {/* ─── MOBILE FIXED ELEMENTS (outside flex flow, above nav) ─── */}
      {isTouch && activeTab === "map" && snapshot && (
        <div className="fixed left-0 right-0 z-[24] px-2" style={{ bottom: '72px' }}>
          <button
            onClick={() => setMobileSheetOpen(!mobileSheetOpen)}
            className="w-full backdrop-blur-xl bg-slate-900/80 border border-white/10 rounded-xl px-4 py-3.5 flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-5 text-sm overflow-x-auto">
              <span className="flex items-center gap-2 text-blue-300 shrink-0">
                <Waves className="h-5 w-5" />
                <span className="font-semibold">{snapshot.waterLevel.effectiveValue.toFixed(2)}m</span>
              </span>
              <span className="flex items-center gap-2 text-cyan-300 shrink-0">
                <CloudRain className="h-5 w-5" />
                <span className="font-semibold">{snapshot.rainfall.toFixed(1)}mm</span>
              </span>
              <span className={`flex items-center gap-2 shrink-0 ${
                snapshot.risk > 0.8 ? "text-red-400" :
                snapshot.risk > 0.5 ? "text-orange-400" :
                "text-emerald-400"
              }`}>
                <AlertOctagon className="h-5 w-5" />
                <span className="font-semibold">{(snapshot.risk * 100).toFixed(0)}%</span>
              </span>
              <span className="flex items-center gap-2 text-teal-300 shrink-0">
                <ThermometerSun className="h-5 w-5" />
                <span className="font-semibold">{snapshot.humidity.effectiveValue.toFixed(0)}%</span>
              </span>
            </div>
            <ChevronUp className={`h-6 w-6 text-white/40 shrink-0 ml-2 transition-transform ${mobileSheetOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}

      {/* ═══════ MOBILE: Bottom Sheet (expanded sensor data) ═══════ */}
      {isTouch && activeTab === "map" && mobileSheetOpen && (
        <div
          className="fixed left-0 right-0 z-[24] overflow-y-auto px-2 scrollbar-thin"
          style={{ bottom: '130px', maxHeight: '65vh' }}
        >
          <div className="flex justify-center py-1.5">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          <GlassPanel className="p-3 space-y-3">
            {renderSensorPanelContent()}
            <div>
              <h2 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-blue-400 uppercase tracking-wider">
                <TrendingUp className="h-3.5 w-3.5" />
                Live Trends
              </h2>
              <div className="max-h-[200px] overflow-y-auto dark glass-dark">
                <ErrorBoundary>
                  <SensorGraphs history={history} unit="metric" />
                </ErrorBoundary>
              </div>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* ═══════ MOBILE: Layers FAB — fixed above nav, always clickable ═══════ */}
      {isTouch && activeTab === "map" && !mobileSheetOpen && (
        <button
          onClick={() => setMobileLayersOpen(true)}
          className="fixed z-[24] backdrop-blur-xl bg-slate-900/80 border border-white/20 rounded-full h-14 w-14 flex items-center justify-center text-white/80 hover:text-white shadow-xl"
          style={{ bottom: '80px', right: '16px' }}
        >
          <Layers className="h-6 w-6" />
        </button>
      )}

      {/* ═══════ DESKTOP FOOTER: STATUS + NAV (lg+ only) ═══════ */}
      {!isTouch && (
        <div className="hidden lg:block fixed bottom-0 left-0 right-0 z-[25] pointer-events-auto">
          <GlassPanel className="mx-2 mb-2 px-3 py-1 flex items-center justify-between rounded-xl overflow-hidden">
            {/* Left: status info */}
            <div className="flex items-center gap-4 min-w-0 overflow-hidden text-[11px]">
              <div className="flex items-center gap-1.5">
                <Radio className={`h-3 w-3 ${networkOnline ? "text-emerald-400" : "text-red-400"}`} />
                <span className="text-white/60">
                  LoRaWAN • Sync: {snapshot?.timestamp.toLocaleTimeString() ?? "—"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-white/60">
                <ShieldAlert className="h-3 w-3" />
                <span>Sensors: {ALL_SENSOR_IDS.filter((id) => isSensorOnline(id)).length}/{ALL_SENSOR_IDS.length} online</span>
              </div>
              <div className="flex items-center gap-1.5 text-white/60">
                <Activity className="h-3 w-3" />
                <span>Uptime: {uptimeStr}</span>
              </div>
              <div className="text-white/40">
                14.7094°N, 120.9358°E
              </div>
            </div>
            {/* Right: navigation tabs (inline horizontal) */}
            <div className="flex items-center gap-0.5 shrink-0">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id
                const isDisabled = tab.id === "controls" && user?.role === "viewer"
                return (
                  <button
                    key={tab.id}
                    disabled={isDisabled}
                    onClick={() => {
                      if (!isDisabled) {
                        setActiveTab(tab.id)
                      }
                    }}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                      ${isActive
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "text-white/50 hover:text-white/80 hover:bg-white/5"
                      }
                      ${isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
                    `}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    {tab.id === "history" && unackCritical > 0 && (
                      <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] text-white font-bold">
                        {unackCritical}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </GlassPanel>
        </div>
      )}

      {/* ═══════ MOBILE FIXED BOTTOM NAVIGATION BAR ═══════ */}
      {/* h-16 = 64px — guaranteed tap height on mobile. Hidden on lg+ (desktop uses inline footer nav). */}
      {isTouch && (
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-[25] pointer-events-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="backdrop-blur-xl bg-slate-900/90 border-t border-white/10 flex items-stretch h-16">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            const isDisabled = tab.id === "controls" && user?.role === "viewer"
            return (
              <button
                key={tab.id}
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) {
                    setActiveTab(tab.id)
                    setMobileSheetOpen(false)
                  }
                }}
                className={`
                  flex-1 h-full flex flex-col items-center justify-center gap-1 relative
                  transition-colors duration-150
                  ${isActive
                    ? "text-cyan-300 bg-cyan-500/10"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                  }
                  ${isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
                `}
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-cyan-400" />
                )}
                <div className="h-6 w-6 flex items-center justify-center">
                  {tab.iconTouch}
                </div>
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                {tab.id === "history" && unackCritical > 0 && (
                  <span className="absolute top-2 right-[calc(50%-14px)] inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white font-bold">
                    {unackCritical}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </nav>
      )}

      {/* ═══════ Z-30: MOBILE LAYERS MODAL ═══════ */}
      {mobileLayersOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex flex-col">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setMobileLayersOpen(false)}
          />
          {/* Modal content */}
          <div className="relative flex flex-col m-2 mt-12 mb-16 overflow-hidden">
            <GlassPanel className="flex flex-col flex-1 overflow-hidden dark glass-dark">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Map Layers
                </h2>
                <button
                  onClick={() => setMobileLayersOpen(false)}
                  className="h-11 w-11 flex items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
                <ErrorBoundary>
                  <MapControls config={layers} actions={layerActions} rainViewer={rainViewer} himawariAnimation={himawariAnimationData} himawariHook={himawari} />
                </ErrorBoundary>
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </div>
  )
}
