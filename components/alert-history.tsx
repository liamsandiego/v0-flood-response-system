"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertTriangle, Droplets, Clock } from "lucide-react"
import type { SensorData } from "@/lib/types"

interface AlertHistoryProps {
  sensors: SensorData[]
}

export function AlertHistory({ sensors }: AlertHistoryProps) {
  // Generate mock history based on current sensor data
  const history = sensors
    .flatMap((sensor) => [
      {
        id: `${sensor.id}-1`,
        sensor: sensor.name,
        level: sensor.waterLevel,
        status: sensor.status,
        timestamp: new Date(Date.now() - 300000),
        message: `Water level ${sensor.status === "critical" ? "exceeded" : "approaching"} threshold`,
      },
      {
        id: `${sensor.id}-2`,
        sensor: sensor.name,
        level: sensor.waterLevel - 0.2,
        status: sensor.waterLevel - 0.2 > 1.0 ? "critical" : sensor.waterLevel - 0.2 > 0.7 ? "warning" : "normal",
        timestamp: new Date(Date.now() - 600000),
        message: "Water level update",
      },
    ])
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

  const getStatusColor = (status: string) => {
    switch (status) {
      case "critical":
        return "bg-red-500 text-white"
      case "warning":
        return "bg-yellow-500 text-black"
      default:
        return "bg-blue-500 text-white"
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {history.map((event) => (
              <div key={event.id} className="flex gap-4 rounded-lg border border-border p-4">
                <div className="flex-shrink-0">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${getStatusColor(
                      event.status,
                    )}`}
                  >
                    {event.status === "critical" ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : (
                      <Droplets className="h-5 w-5" />
                    )}
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{event.sensor}</p>
                    <Badge variant="outline" className={getStatusColor(event.status)}>
                      {event.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{event.message}</p>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-medium">{event.level.toFixed(2)}m</span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {event.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
