"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Line, LineChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { SensorData } from "@/lib/types"
import { useTheme } from "@/components/theme-provider"

interface SensorGraphsProps {
  sensors: SensorData[]
}

export function SensorGraphs({ sensors }: SensorGraphsProps) {
  const { theme } = useTheme()
  const dotColor = theme === "dark" ? "#ffffff" : "#000000"

  // Generate historical data for the last 2 hours
  const historicalData = useMemo(() => {
    const data = []
    const now = Date.now()
    const twoHoursAgo = now - 2 * 60 * 60 * 1000

    for (let time = twoHoursAgo; time <= now; time += 10 * 60 * 1000) {
      const entry: any = {
        time: new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }

      sensors.forEach((sensor) => {
        // Simulate historical data with some variation
        const variation = Math.sin(time / 1000000) * 0.3
        entry[`${sensor.id}_water`] = Math.max(0, sensor.waterLevel + variation)
        entry[`${sensor.id}_rain`] = Math.max(0, sensor.rainfall + Math.random() * 10 - 5)
      })

      data.push(entry)
    }

    return data
  }, [sensors])

  const waterLevelConfig = {
    sensor_01_water: {
      label: "Sensor 01",
      color: "hsl(var(--chart-1))",
    },
    sensor_02_water: {
      label: "Sensor 02",
      color: "hsl(var(--chart-2))",
    },
    sensor_03_water: {
      label: "Sensor 03",
      color: "hsl(var(--chart-3))",
    },
  }

  const rainfallConfig = {
    sensor_01_rain: {
      label: "Sensor 01",
      color: "hsl(var(--chart-1))",
    },
    sensor_02_rain: {
      label: "Sensor 02",
      color: "hsl(var(--chart-2))",
    },
    sensor_03_rain: {
      label: "Sensor 03",
      color: "hsl(var(--chart-3))",
    },
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Water Level Trends</CardTitle>
          <CardDescription>Last 2 hours of water level data (meters)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={waterLevelConfig} className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="sensor_01_water"
                  stroke="var(--color-sensor_01_water)"
                  name="Sensor 01"
                  strokeWidth={2}
                  dot={{ fill: dotColor, r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="sensor_02_water"
                  stroke="var(--color-sensor_02_water)"
                  name="Sensor 02"
                  strokeWidth={2}
                  dot={{ fill: dotColor, r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="sensor_03_water"
                  stroke="var(--color-sensor_03_water)"
                  name="Sensor 03"
                  strokeWidth={2}
                  dot={{ fill: dotColor, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rainfall Trends</CardTitle>
          <CardDescription>Last 2 hours of rainfall data (mm)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={rainfallConfig} className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="sensor_01_rain"
                  stroke="var(--color-sensor_01_rain)"
                  name="Sensor 01"
                  strokeWidth={2}
                  dot={{ fill: dotColor, r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="sensor_02_rain"
                  stroke="var(--color-sensor_02_rain)"
                  name="Sensor 02"
                  strokeWidth={2}
                  dot={{ fill: dotColor, r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="sensor_03_rain"
                  stroke="var(--color-sensor_03_rain)"
                  name="Sensor 03"
                  strokeWidth={2}
                  dot={{ fill: dotColor, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
