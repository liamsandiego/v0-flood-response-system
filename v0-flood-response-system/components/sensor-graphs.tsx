"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Line, LineChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { SENSOR_REGISTRY } from "@/lib/constants"
import { convertValue, getDisplayUnit } from "@/lib/conversion"
import { useFloodStore } from "@/stores/sensorStore"
import type { SensorSnapshot, MeasurementUnit } from "@/lib/types"

interface SensorGraphsProps {
  history: SensorSnapshot[]
}

export function SensorGraphs({ history }: SensorGraphsProps) {
  const unit = useFloodStore((s) => s.unit)
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false

  const getXAxisInterval = (length: number) => {
    if (!isMobile) return "preserveStartEnd" as const
    if (length <= 12) return 1
    return Math.max(2, Math.floor(length / 8))
  }

  const showDots = !isMobile
  // Build chart data from real Supabase history (linked to sensor_readings)
  const waterLevelData = useMemo(() => {
    return history.map((snap) => ({
      time: snap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      value: convertValue("ultrasonic_water_level", snap.waterLevel.effectiveValue, unit),
    }))
  }, [history, unit])

  const soilMoistureData = useMemo(() => {
    return history.map((snap) => ({
      time: snap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      value: snap.soilMoisture.effectiveValue,
    }))
  }, [history])

  const humidityData = useMemo(() => {
    return history.map((snap) => ({
      time: snap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      value: snap.humidity.effectiveValue,
    }))
  }, [history])

  const temperatureData = useMemo(() => {
    return history.map((snap) => ({
      time: snap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      value: snap.temperature?.effectiveValue ?? 0,
    }))
  }, [history])

  const pressureData = useMemo(() => {
    return history.map((snap) => ({
      time: snap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      value: snap.pressure?.effectiveValue ?? 0,
    }))
  }, [history])

  const waterMeta = SENSOR_REGISTRY.ultrasonic_water_level
  const soilMeta = SENSOR_REGISTRY.capacitive_soil_moisture
  const humidMeta = SENSOR_REGISTRY.humidity_dht22

  const waterUnit = getDisplayUnit("ultrasonic_water_level", unit)

  const waterWarning = convertValue("ultrasonic_water_level", waterMeta.thresholds.warning, unit)
  const waterCritical = convertValue("ultrasonic_water_level", waterMeta.thresholds.critical, unit)

  const waterConfig = { value: { label: `Water Level (${waterUnit})`, color: "var(--chart-1)" } }
  const soilConfig = { value: { label: "Soil Moisture (%)", color: "var(--chart-2)" } }
  const humidConfig = { value: { label: "Humidity (%)", color: "var(--chart-3)" } }
  const tempConfig = { value: { label: "Temperature (°C)", color: "var(--chart-4)" } }
  const pressConfig = { value: { label: "Pressure (hPa)", color: "var(--chart-5)" } }

  if (history.length < 2) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Collecting sensor data… Graphs will appear after a few readings.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 w-full min-w-0">
      {/* Water Level — full width */}
      <Card className="col-span-1 md:col-span-2 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">{waterMeta.shortLabel} Trend</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Thresholds: Warning={waterWarning.toFixed(1)}{waterUnit}, Critical={waterCritical.toFixed(1)}{waterUnit}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2 md:p-6 pt-0">
          <ChartContainer config={waterConfig} className="h-[200px] md:h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={waterLevelData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={getXAxisInterval(waterLevelData.length)} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={waterWarning} stroke="#f59e0b" strokeDasharray="6 3" label={{ value: "Warn", fontSize: 9, position: "insideTopLeft" }} />
                <ReferenceLine y={waterCritical} stroke="#ef4444" strokeDasharray="6 3" label={{ value: "Crit", fontSize: 9, position: "insideTopLeft" }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  name={`Water Level (${waterUnit})`}
                  strokeWidth={2}
                  dot={showDots ? { r: 3, fill: "var(--color-value)" } : false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Soil Moisture */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">{soilMeta.shortLabel} Trend</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Warning={soilMeta.thresholds.warning}%, Critical={soilMeta.thresholds.critical}%
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2 md:p-6 pt-0">
          <ChartContainer config={soilConfig} className="h-[180px] md:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={soilMoistureData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={getXAxisInterval(soilMoistureData.length)} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} width={35} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={soilMeta.thresholds.warning} stroke="#f59e0b" strokeDasharray="6 3" />
                <ReferenceLine y={soilMeta.thresholds.critical} stroke="#ef4444" strokeDasharray="6 3" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  name="Soil Moisture (%)"
                  strokeWidth={2}
                  dot={showDots ? { r: 3, fill: "var(--color-value)" } : false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Humidity */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">{humidMeta.shortLabel} Trend</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Warning={humidMeta.thresholds.warning}%, Critical={humidMeta.thresholds.critical}%
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2 md:p-6 pt-0">
          <ChartContainer config={humidConfig} className="h-[180px] md:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={humidityData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={getXAxisInterval(humidityData.length)} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} width={35} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={humidMeta.thresholds.warning} stroke="#f59e0b" strokeDasharray="6 3" />
                <ReferenceLine y={humidMeta.thresholds.critical} stroke="#ef4444" strokeDasharray="6 3" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  name="Humidity (%)"
                  strokeWidth={2}
                  dot={showDots ? { r: 3, fill: "var(--color-value)" } : false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Temperature */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">Temperature Trend</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Warning=35°C, Critical=40°C
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2 md:p-6 pt-0">
          <ChartContainer config={tempConfig} className="h-[180px] md:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={temperatureData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={getXAxisInterval(temperatureData.length)} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 5", "dataMax + 5"]} width={35} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={35} stroke="#f59e0b" strokeDasharray="6 3" />
                <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="6 3" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  name="Temperature (°C)"
                  strokeWidth={2}
                  dot={showDots ? { r: 3, fill: "var(--color-value)" } : false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Pressure */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">Pressure Trend</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Warning=950hPa, Critical=900hPa
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2 md:p-6 pt-0">
          <ChartContainer config={pressConfig} className="h-[180px] md:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={getXAxisInterval(pressureData.length)} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 10", "dataMax + 10"]} width={35} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={950} stroke="#f59e0b" strokeDasharray="6 3" />
                <ReferenceLine y={900} stroke="#ef4444" strokeDasharray="6 3" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  name="Pressure (hPa)"
                  strokeWidth={2}
                  dot={showDots ? { r: 3, fill: "var(--color-value)" } : false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
