"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FloodMap } from "@/components/flood-map"
import { AlertHistory } from "@/components/alert-history"
import { AlertControls } from "@/components/alert-controls"
import { SensorGraphs } from "@/components/sensor-graphs"
import { Droplets, CloudRain, Clock, Radio, LogOut, User } from "lucide-react"
import type { SensorData, AlertLevel } from "@/lib/types"
import type { UserRole } from "@/components/auth-provider"

interface DashboardProps {
  user: { username: string; role: UserRole; name: string }
  onLogout: () => void
}

export function Dashboard({ user, onLogout }: DashboardProps) {
  const [sensors, setSensors] = useState<SensorData[]>([
    {
      id: "sensor_01",
      name: "Sensor 01",
      waterLevel: 0.85,
      rainfall: 12.5,
      status: "warning",
      lat: 14.5547,
      lng: 121.0503,
      lastUpdate: new Date(),
    },
    {
      id: "sensor_02",
      name: "Sensor 02",
      waterLevel: 1.25,
      rainfall: 28.3,
      status: "critical",
      lat: 14.5557,
      lng: 121.0513,
      lastUpdate: new Date(),
    },
    {
      id: "sensor_03",
      name: "Sensor 03",
      waterLevel: 0.45,
      rainfall: 5.2,
      status: "normal",
      lat: 14.5537,
      lng: 121.0493,
      lastUpdate: new Date(),
    },
  ])

  const [overallStatus, setOverallStatus] = useState<AlertLevel>("warning")

  useEffect(() => {
    // Simulate real-time sensor updates
    const interval = setInterval(() => {
      setSensors((prev) =>
        prev.map((sensor) => ({
          ...sensor,
          waterLevel: Math.max(0, sensor.waterLevel + (Math.random() - 0.5) * 0.1),
          rainfall: Math.max(0, sensor.rainfall + (Math.random() - 0.5) * 2),
          lastUpdate: new Date(),
        })),
      )
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Update overall status based on sensors
    const hasCritical = sensors.some((s) => s.waterLevel > 1.0)
    const hasWarning = sensors.some((s) => s.waterLevel > 0.7)

    if (hasCritical) {
      setOverallStatus("critical")
    } else if (hasWarning) {
      setOverallStatus("warning")
    } else {
      setOverallStatus("normal")
    }
  }, [sensors])

  const getStatusColor = (status: AlertLevel) => {
    switch (status) {
      case "critical":
        return "bg-red-500 text-white"
      case "warning":
        return "bg-yellow-500 text-black"
      default:
        return "bg-blue-500 text-white"
    }
  }

  const getStatusText = (status: AlertLevel) => {
    switch (status) {
      case "critical":
        return "CRITICAL ALERT"
      case "warning":
        return "WARNING"
      default:
        return "NORMAL"
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

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-balance">Rapid Relay</h1>
            <p className="text-muted-foreground">Barangay East Rembo Flood Response System</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="text-sm font-medium">{user.name}</span>
              <Badge className={getRoleBadge(user.role)}>{user.role.toUpperCase()}</Badge>
            </div>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
            <Badge className={`${getStatusColor(overallStatus)} text-lg px-4 py-2`}>
              {getStatusText(overallStatus)}
            </Badge>
          </div>
        </div>

        {/* Real-time Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          {sensors.map((sensor) => (
            <Card key={sensor.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{sensor.name}</CardTitle>
                  <Badge variant="outline" className={getStatusColor(sensor.status)}>
                    {sensor.status.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Droplets className="h-4 w-4 text-blue-500" />
                  <span className="text-2xl font-bold">{sensor.waterLevel.toFixed(2)}m</span>
                  <span className="text-sm text-muted-foreground">Water Level</span>
                </div>
                <div className="flex items-center gap-2">
                  <CloudRain className="h-4 w-4 text-gray-500" />
                  <span className="text-lg font-semibold">{sensor.rainfall.toFixed(1)}mm</span>
                  <span className="text-sm text-muted-foreground">Rainfall</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Updated: {sensor.lastUpdate.toLocaleTimeString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="map" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="map">Community Map</TabsTrigger>
            <TabsTrigger value="graphs">Data Graphs</TabsTrigger>
            <TabsTrigger value="history">Alert History</TabsTrigger>
            <TabsTrigger value="controls" disabled={user.role === "viewer"}>
              Alert Controls
            </TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Flood Monitoring Map</CardTitle>
                <CardDescription>Real-time sensor locations and flood-prone zones</CardDescription>
              </CardHeader>
              <CardContent>
                <FloodMap sensors={sensors} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="graphs">
            <SensorGraphs sensors={sensors} />
          </TabsContent>

          <TabsContent value="history">
            <AlertHistory sensors={sensors} />
          </TabsContent>

          <TabsContent value="controls">
            {user.role === "viewer" ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  You do not have permission to access alert controls. Contact an administrator for access.
                </CardContent>
              </Card>
            ) : (
              <AlertControls currentStatus={overallStatus} userRole={user.role} />
            )}
          </TabsContent>
        </Tabs>

        {/* Data Source Info */}
        <Card>
          <CardContent className="flex items-center gap-2 py-3">
            <Radio className="h-4 w-4 text-green-500" />
            <span className="text-sm text-muted-foreground">
              Data Source: Local Node (LoRaWAN) • Last sync: {new Date().toLocaleTimeString()}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
