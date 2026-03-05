"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OptimizedLeafletMap } from "@/components/map/OptimizedLeafletMap"
import { MapControls } from "@/components/map/MapControls"
import { AlertHistory } from "@/components/alert-history"
import { AlertControls } from "@/components/alert-controls"
import { SensorGraphs } from "@/components/sensor-graphs"
import { EvacuationTips } from "@/components/evacuation-tips"
import { PwaInstallButton } from "@/components/pwa-install-button"
import { NotificationButton } from "@/components/notification-button"
import { UnitToggle } from "@/components/unit-toggle"
import { ErrorBoundary } from "@/components/error-boundary"
import { SmsBroadcastLog } from "@/components/sms-broadcast-log"
import { DataTab } from "@/components/data-tab"
import {
  Droplets, Waves, ThermometerSun, Clock, Radio,
  LogOut, User, Moon, Sun, ShieldAlert, Activity,
  AlertTriangle, CloudRain, Maximize, TrendingUp, TrendingDown, Minus, AlertOctagon,
} from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { useMeasurementUnit } from "@/hooks/use-measurement-unit"
import { useNotifications } from "@/hooks/use-notifications"
import { usePersistentAlerts } from "@/hooks/use-persistent-alerts"
import { useMapLayers } from "@/hooks/use-map-layers"
import { useRainViewer } from "@/hooks/use-rainviewer"
import { generateSnapshot } from "@/lib/sensor-simulator"
import { evaluateSnapshot, evaluateSensorHealth } from "@/lib/alert-engine"
import { formatSensorValue } from "@/lib/conversion"
import { isSensorOnline, getConsecutiveFailures } from "@/lib/sensor-validation"
import { DEPLOYMENT, SENSOR_REGISTRY, SENSOR_POLL_INTERVAL_MS, ALL_SENSOR_IDS } from "@/lib/constants"
import { mockEvents } from "@/data/mockEvents"
import type { SensorSnapshot, AlertLevel, MeasurementUnit, SensorReading } from "@/lib/types"
import type { UserRole } from "@/components/auth-provider"

interface DashboardProps {
  user: { username: string; role: UserRole; name: string }
  onLogout: () => void
}

export function Dashboard({ user, onLogout }: DashboardProps) {
  const { theme, toggleTheme } = useTheme()
  const { unit, toggleUnit } = useMeasurementUnit()
  const { sendNotification } = useNotifications()
  const { alerts, addAlerts, acknowledgeAlert, clearAll } = usePersistentAlerts()
  const { layers, actions: layerActions } = useMapLayers()
  const rainViewer = useRainViewer()

  const [snapshot, setSnapshot] = useState<SensorSnapshot | null>(null)
  const [history, setHistory] = useState<SensorSnapshot[]>([])
  const [flashSensor, setFlashSensor] = useState<string | null>(null)
  const [networkOnline, setNetworkOnline] = useState(true)
  const startTime = useRef(Date.now())
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Stable refs for callbacks — prevents useEffect dependency changes
  // ── RainViewer animation loop ──────────────────────────────────────────
  useEffect(() => {
    if (!layers.rainViewer.enabled || !layers.rainViewer.animating) return
    if (rainViewer.frames.length === 0) return

    const interval = setInterval(() => {
      rainViewer.nextFrame()
    }, layers.rainViewer.animationSpeed)

    return () => clearInterval(interval)
  }, [layers.rainViewer.enabled, layers.rainViewer.animating, layers.rainViewer.animationSpeed, rainViewer.frames.length, rainViewer.nextFrame])

  // ── Build RainViewer tile URL for current frame ───────────────────────
  const rainViewerTileUrl = (() => {
    if (!layers.rainViewer.enabled || rainViewer.frames.length === 0) return null
    const frame = rainViewer.frames[rainViewer.currentFrameIndex]
    if (!frame) return null
    return rainViewer.getTileUrl(
      frame,
      layers.rainViewer.colorScheme,
      layers.rainViewer.smooth,
      layers.rainViewer.snow
    )
  })()

  const addAlertsRef = useRef(addAlerts)
  addAlertsRef.current = addAlerts
  const sendNotificationRef = useRef(sendNotification)
  sendNotificationRef.current = sendNotification

  // ---------------------------------------------------------------------------
  // Network status tracking
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Siren Effect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (snapshot?.overallStatus === "critical") {
      // Play siren if critical
      if (audioRef.current) {
        audioRef.current.loop = true
        audioRef.current.play().catch(e => console.log("Audio play blocked:", e))
      }
    } else {
      // Stop siren if not critical
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [snapshot?.overallStatus])

  // ---------------------------------------------------------------------------
  // Sensor polling loop with auto-recovery
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let failedTicks = 0
    const MAX_FAILED_TICKS = 10
    let flashTimeout: ReturnType<typeof setTimeout> | null = null
    let mounted = true

    const tick = () => {
      if (!mounted) return
      try {
        // Use mock data if available, cycling through it based on time
        const eventIndex = Math.floor((Date.now() / 5000) % mockEvents.length)
        const event = mockEvents[eventIndex]

        // Map mock event to SensorSnapshot
        const snap: SensorSnapshot = {
          timestamp: new Date(), // Use current time for live feel, or event.timestamp if replay
          waterLevel: {
            sensorId: "ultrasonic_water_level",
            value: event.water_level / 100, // Convert cm to m for internal logic
            isValid: true,
            effectiveValue: event.water_level / 100,
            timestamp: new Date(),
            status: event.warning_level === "CRITICAL" ? "critical" : event.warning_level === "YELLOW" ? "warning" : "normal",
          },
          soilMoisture: {
            sensorId: "capacitive_soil_moisture",
            value: event.soil_saturation * 100, // Convert 0-1 to %
            isValid: true,
            effectiveValue: event.soil_saturation * 100,
            timestamp: new Date(),
            status: event.soil_saturation > 0.8 ? "critical" : event.soil_saturation > 0.6 ? "warning" : "normal"
          },
          humidity: {
            sensorId: "humidity_dht22",
            value: event.humidity,
            isValid: true,
            effectiveValue: event.humidity,
            timestamp: new Date(),
            status: event.humidity > 90 ? "critical" : event.humidity > 75 ? "warning" : "normal"
          },
          rainfall: event.rainfall,
          floodExtent: event.flood_extent,
          wetnessTrend: event.wetness_trend,
          risk: event.risk,
          overallStatus: (event.warning_level === "CRITICAL" || event.risk > 0.8) ? "critical" : (event.warning_level === "YELLOW" || event.risk > 0.5) ? "warning" : "normal"
        }

        setSnapshot(snap)
        setHistory((prev) => [...prev.slice(-143), snap])

        // Flash animation (debounced — clear previous timer)
        if (flashTimeout) clearTimeout(flashTimeout)
        setFlashSensor("all")
        flashTimeout = setTimeout(() => {
          if (mounted) setFlashSensor(null)
        }, 800)

        // Evaluate alerts
        const thresholdAlerts = evaluateSnapshot(snap)
        const healthAlerts = evaluateSensorHealth(snap)
        const newAlerts = [...thresholdAlerts, ...healthAlerts]

        if (newAlerts.length > 0) {
          addAlertsRef.current(newAlerts)
          for (const a of newAlerts) {
            sendNotificationRef.current(a.title, a.message, a.level)
          }
        }

        failedTicks = 0
      } catch (err) {
        failedTicks++
        console.error(`[Dashboard] Sensor tick error (${failedTicks}/${MAX_FAILED_TICKS}):`, err)

        if (failedTicks >= MAX_FAILED_TICKS) {
          console.warn("[Dashboard] Too many consecutive failures. Reinitializing sensor pipeline.")
          import("@/lib/sensor-validation").then(({ resetAllSensors }) => {
            resetAllSensors()
            failedTicks = 0
          })
        }
      }
    }

    // Initial tick
    tick()
    const interval = setInterval(tick, SENSOR_POLL_INTERVAL_MS)
    return () => {
      mounted = false
      clearInterval(interval)
      if (flashTimeout) clearTimeout(flashTimeout)
    }
  }, []) // empty deps — reads callbacks from stable refs

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const getStatusColor = (status: AlertLevel) => {
    switch (status) {
      case "critical": return "bg-red-500 text-white"
      case "warning": return "bg-yellow-500 text-black"
      default: return "bg-blue-500 text-white"
    }
  }

  const getStatusText = (status: AlertLevel) => {
    switch (status) {
      case "critical": return "CRITICAL ALERT"
      case "warning": return "WARNING"
      default: return "NORMAL"
    }
  }

  const getRoleBadge = (role: UserRole) => {
    const colors = {
      admin: "bg-purple-500 text-white",
      operator: "bg-green-500 text-white",
      viewer: "bg-gray-500 text-white",
    }
    return colors[role]
  }

  const getSensorIcon = (sensorId: string) => {
    switch (sensorId) {
      case "ultrasonic_water_level": return <Waves className="h-4 w-4 text-blue-500" />
      case "capacitive_soil_moisture": return <Droplets className="h-4 w-4 text-amber-600" />
      case "humidity_dht22": return <ThermometerSun className="h-4 w-4 text-teal-500" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const overallStatus = snapshot?.overallStatus ?? "normal"
  const uptime = Math.floor((Date.now() - startTime.current) / 1000)
  const uptimeStr =
    uptime < 60 ? `${uptime}s` :
      uptime < 3600 ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` :
        `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`

  const renderSensorCard = (sensorId: string) => {
    if (!snapshot) return null

    // Type narrowing for sensorId
    if (sensorId !== "ultrasonic_water_level" &&
      sensorId !== "capacitive_soil_moisture" &&
      sensorId !== "humidity_dht22") return null

    const meta = SENSOR_REGISTRY[sensorId]
    const reading =
      sensorId === "ultrasonic_water_level" ? snapshot.waterLevel :
        sensorId === "capacitive_soil_moisture" ? snapshot.soilMoisture :
          snapshot.humidity
    const online = isSensorOnline(sensorId)
    const failures = getConsecutiveFailures(sensorId)

    return (
      <ErrorBoundary key={sensorId}>
        <Card
          className={`transition-all duration-500 ${flashSensor === "all" ? "ring-2 ring-primary shadow-lg scale-[1.02]" : ""
            } ${!online ? "opacity-60 border-red-400" : ""}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getSensorIcon(sensorId)}
                <CardTitle className="text-sm font-medium">{meta.shortLabel}</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                {!reading.isValid && (
                  <Badge variant="outline" className="bg-orange-100 text-orange-700 text-[10px] px-1">
                    FALLBACK
                  </Badge>
                )}
                {!online && (
                  <Badge variant="outline" className="bg-red-100 text-red-700 text-[10px] px-1">
                    OFFLINE
                  </Badge>
                )}
                <Badge variant="outline" className={getStatusColor(reading.status)}>
                  {reading.status.toUpperCase()}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{meta.label}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              {getSensorIcon(sensorId)}
              <span className="text-2xl font-bold">
                {formatSensorValue(sensorId, reading.effectiveValue, unit)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{meta.placement}</p>
            {failures > 0 && (
              <p className="text-xs text-orange-600">
                ⚠ {failures} consecutive invalid reading{failures > 1 ? "s" : ""}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Updated: {reading.timestamp.toLocaleTimeString()}</span>
            </div>
          </CardContent>
        </Card>
      </ErrorBoundary>
    )
  }

  return (
    <div className="min-h-screen bg-background p-3 md:p-6 overflow-x-hidden">
      <audio ref={audioRef} src="/sounds/siren.mp3" preload="auto" />
      <div className="mx-auto max-w-7xl space-y-4 md:space-y-6 w-full min-w-0">
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold truncate">Rapid Relay</h1>
            <p className="text-sm text-muted-foreground truncate">{DEPLOYMENT.name} — Flood Response System</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <div className="flex items-center gap-1.5">
              <User className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-medium truncate max-w-[100px]">{user.name}</span>
              <Badge className={getRoleBadge(user.role)}>{user.role.toUpperCase()}</Badge>
            </div>
            <UnitToggle unit={unit} onToggle={toggleUnit} />
            <PwaInstallButton />
            <NotificationButton />
            <Button variant="outline" size="sm" onClick={toggleTheme}>
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
            <Badge className={`${getStatusColor(overallStatus)} text-sm md:text-lg px-2 md:px-4 py-1 md:py-2`}>
              {getStatusText(overallStatus)}
            </Badge>
          </div>
        </div>

        {/* ─── Network Warning Banner ─────────────────────────────── */}
        {!networkOnline && (
          <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 rounded-lg p-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Network offline — displaying cached data. Alerts will resume when connectivity is restored.
            </span>
          </div>
        )}

        {/* ─── Sensor Cards Grouped ───────────────────────────────── */}
        <div className="space-y-6">

          {/* Section 1: Critical Status */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-500" />
              Critical Status
            </h2>
            <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-2">
              {/* Water Level */}
              {renderSensorCard("ultrasonic_water_level")}

              {/* Risk Factor */}
              {snapshot && (
                <Card className="transition-all duration-500 hover:scale-[1.02] border-l-4 border-l-red-500">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertOctagon className="h-4 w-4 text-red-500" />
                        <CardTitle className="text-sm font-medium">Risk Factor</CardTitle>
                      </div>
                      <Badge variant="outline" className={snapshot.risk > 0.8 ? "bg-red-500 text-white" : snapshot.risk > 0.5 ? "bg-orange-500 text-white" : "bg-green-500 text-white"}>
                        {snapshot.risk > 0.8 ? "HIGH" : snapshot.risk > 0.5 ? "MEDIUM" : "LOW"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Composite Risk Score</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertOctagon className="h-4 w-4 text-red-500" />
                      <span className="text-2xl font-bold">{(snapshot.risk * 100).toFixed(1)} %</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Algo-driven Threat Level</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Updated: {snapshot.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Section 2: Environmental Conditions */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <ThermometerSun className="h-5 w-5 text-orange-500" />
              Environmental Conditions
            </h2>
            <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
              {/* Rainfall */}
              {snapshot && (
                <Card className="transition-all duration-500 hover:scale-[1.02]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CloudRain className="h-4 w-4 text-blue-400" />
                        <CardTitle className="text-sm font-medium">Rainfall</CardTitle>
                      </div>
                      <Badge variant="outline" className={snapshot.rainfall > 30 ? "bg-red-500 text-white" : snapshot.rainfall > 7.5 ? "bg-yellow-500 text-black" : "bg-blue-500 text-white"}>
                        {snapshot.rainfall > 30 ? "HEAVY" : snapshot.rainfall > 7.5 ? "MODERATE" : "LIGHT"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Precipitation Rate</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <CloudRain className="h-4 w-4 text-blue-400" />
                      <span className="text-2xl font-bold">{snapshot.rainfall.toFixed(1)} mm</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Obando Station Gauge</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Updated: {snapshot.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Humidity */}
              {renderSensorCard("humidity_dht22")}

              {/* Soil Moisture */}
              {renderSensorCard("capacitive_soil_moisture")}
            </div>
          </div>

          {/* Section 3: Analysis & Trends */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Activity className="h-5 w-5 text-purple-500" />
              Analysis & Trends
            </h2>
            <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-2">
              {/* Flood Extent */}
              {snapshot && (
                <Card className="transition-all duration-500 hover:scale-[1.02]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Maximize className="h-4 w-4 text-purple-500" />
                        <CardTitle className="text-sm font-medium">Flood Extent</CardTitle>
                      </div>
                      <Badge variant="outline" className="bg-purple-100 text-purple-700">
                        ESTIMATED
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Area Coverage</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Maximize className="h-4 w-4 text-purple-500" />
                      <span className="text-2xl font-bold">{(snapshot.floodExtent * 100).toFixed(1)} %</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Monitored Zone Coverage</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Updated: {snapshot.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Wetness Trend */}
              {snapshot && (
                <Card className="transition-all duration-500 hover:scale-[1.02]">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {snapshot.wetnessTrend > 0 ? <TrendingUp className="h-4 w-4 text-orange-500" /> :
                          snapshot.wetnessTrend < 0 ? <TrendingDown className="h-4 w-4 text-green-500" /> :
                            <Minus className="h-4 w-4 text-gray-500" />}
                        <CardTitle className="text-sm font-medium">Wetness Trend</CardTitle>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Saturation Direction</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      {snapshot.wetnessTrend > 0 ? <TrendingUp className="h-4 w-4 text-orange-500" /> :
                        snapshot.wetnessTrend < 0 ? <TrendingDown className="h-4 w-4 text-green-500" /> :
                          <Minus className="h-4 w-4 text-gray-500" />}
                      <span className="text-2xl font-bold">
                        {snapshot.wetnessTrend > 0 ? "Rising" : snapshot.wetnessTrend < 0 ? "Falling" : "Stable"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Rate: {Math.abs(snapshot.wetnessTrend)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Updated: {snapshot.timestamp.toLocaleTimeString()}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
          {/* Section 4: Live Sensor Trends */}
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              Live Sensor Trends
            </h2>
            <Card>
              <CardContent className="pt-6">
                <SensorGraphs history={history} unit={unit} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ─── Main Content Tabs ──────────────────────────────────── */}
        <Tabs defaultValue="map" className="space-y-4 min-w-0">
          <TabsList className="flex w-full overflow-x-auto">
            <TabsTrigger value="map">Map</TabsTrigger>
            {/* <TabsTrigger value="graphs">Graphs</TabsTrigger> Moved to main view */}
            <TabsTrigger value="evacuation">Safety</TabsTrigger>
            <TabsTrigger value="history">
              History
              {alerts.filter((a) => !a.acknowledged && a.level === "critical").length > 0 && (
                <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {alerts.filter((a) => !a.acknowledged && a.level === "critical").length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="controls" disabled={user.role === "viewer"}>
              Controls
            </TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="space-y-4">
            <ErrorBoundary>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                {/* Map occupies most of the width */}
                <Card>
                  <CardHeader>
                    <CardTitle>Flood Monitoring Map</CardTitle>
                    <CardDescription>
                      Sensor location at {DEPLOYMENT.name} — near dike / flood gate
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <OptimizedLeafletMap snapshot={snapshot} unit={unit} layers={layers} rainViewerTileUrl={rainViewerTileUrl} rainViewerLoading={rainViewer.loading} />
                  </CardContent>
                </Card>
                {/* Layer controls sidebar */}
                <div className="space-y-4">
                  <MapControls config={layers} actions={layerActions} rainViewer={rainViewer} />
                </div>
              </div>
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="graphs">
            <ErrorBoundary>
              <SensorGraphs history={history} unit={unit} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="evacuation">
            <ErrorBoundary>
              <EvacuationTips />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="history">
            <ErrorBoundary>
              <AlertHistory
                alerts={alerts}
                unit={unit}
                onAcknowledge={acknowledgeAlert}
                onClearAll={clearAll}
                userRole={user.role}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="broadcasts">
            <ErrorBoundary>
              <SmsBroadcastLog alerts={alerts} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="data">
            <ErrorBoundary>
              <DataTab history={history} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="controls">
            {user.role === "viewer" ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  You do not have permission to access alert controls. Contact an administrator for access.
                </CardContent>
              </Card>
            ) : (
              <ErrorBoundary>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <AlertControls
                    currentStatus={overallStatus}
                    userRole={user.role}
                    snapshot={snapshot}
                  />
                  <MapControls config={layers} actions={layerActions} rainViewer={rainViewer} />
                </div>
              </ErrorBoundary>
            )}
          </TabsContent>
        </Tabs>

        {/* ─── System Status Footer ───────────────────────────────── */}
        <Card>
          <CardContent className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2 sm:gap-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Radio className={`h-4 w-4 flex-shrink-0 ${networkOnline ? "text-green-500" : "text-red-500"}`} />
              <span className="text-xs sm:text-sm text-muted-foreground truncate">
                LoRaWAN • Sync: {snapshot?.timestamp.toLocaleTimeString() ?? "—"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 flex-shrink-0" />
              <span>Sensors: {ALL_SENSOR_IDS.filter((id) => isSensorOnline(id)).length}/{ALL_SENSOR_IDS.length} online</span>
            </div>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <Activity className="h-4 w-4 flex-shrink-0" />
              <span>Uptime: {uptimeStr}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div >
  )
}
