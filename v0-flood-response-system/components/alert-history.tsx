"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertTriangle, Droplets, Clock, CheckCircle, Trash2, ShieldAlert } from "lucide-react"
import { formatSensorValue } from "@/lib/conversion"
import { SENSOR_REGISTRY } from "@/lib/constants"
import type { AlertRecord, MeasurementUnit } from "@/lib/types"
import type { UserRole } from "@/components/auth-provider"

interface AlertHistoryProps {
  alerts: AlertRecord[]
  unit: MeasurementUnit
  onAcknowledge: (id: string) => void
  onClearAll: () => void
  userRole: UserRole
}

export function AlertHistory({ alerts, unit, onAcknowledge, onClearAll, userRole }: AlertHistoryProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "critical": return "bg-red-500 text-white"
      case "warning": return "bg-yellow-500 text-black"
      default: return "bg-blue-500 text-white"
    }
  }

  const criticalUnack = alerts.filter((a) => a.level === "critical" && !a.acknowledged)
  const totalAlerts = alerts.length

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base md:text-lg">Alert Timeline</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {totalAlerts} alert{totalAlerts !== 1 ? "s" : ""}
              {criticalUnack.length > 0 && (
                <span className="text-red-500 font-semibold ml-1">
                  • {criticalUnack.length} critical
                </span>
              )}
            </CardDescription>
          </div>
          {userRole !== "viewer" && alerts.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClearAll} className="gap-1 flex-shrink-0">
              <Trash2 className="h-3 w-3" />
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        {alerts.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No alerts yet. The system will log alerts when thresholds are crossed.</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] md:h-[500px]">
            <div className="space-y-2 pr-2 md:pr-4">
              {alerts.map((alert) => {
                const ts = new Date(alert.timestamp)
                return (
                  <div
                    key={alert.id}
                    className={`rounded-lg border p-3 md:p-4 transition-colors ${
                      alert.level === "critical" && !alert.acknowledged
                        ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                        : "border-border"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0">
                        <div
                          className={`flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full ${getStatusColor(alert.level)}`}
                        >
                          {alert.level === "critical" ? (
                            <AlertTriangle className="h-4 w-4 md:h-5 md:w-5" />
                          ) : (
                            <Droplets className="h-4 w-4 md:h-5 md:w-5" />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-start gap-1">
                          <p className="font-semibold text-xs md:text-sm flex-1 min-w-0 break-words">{alert.title}</p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {alert.persistent && (
                              <Badge variant="outline" className="text-[9px] md:text-[10px] px-1">PIN</Badge>
                            )}
                            <Badge variant="outline" className={`${getStatusColor(alert.level)} text-[10px]`}>
                              {alert.level.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs md:text-sm text-muted-foreground break-words">{alert.message}</p>

                        {/* Sensor snapshot at time of alert */}
                        <div className="flex flex-wrap gap-2 text-[10px] md:text-xs text-muted-foreground pt-1">
                          <span>🌊 {formatSensorValue("ultrasonic_water_level", alert.sensorSnapshot.waterLevel, unit)}</span>
                          <span>💧 {alert.sensorSnapshot.soilMoisture.toFixed(1)}%</span>
                          <span>🌡️ {alert.sensorSnapshot.humidity.toFixed(1)}%</span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="flex items-center gap-1 text-[10px] md:text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {ts.toLocaleTimeString()}
                          </span>
                          {alert.level === "critical" && !alert.acknowledged && userRole !== "viewer" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onAcknowledge(alert.id)}
                              className="h-6 text-[10px] md:text-xs gap-1"
                            >
                              <CheckCircle className="h-3 w-3" />
                              Ack
                            </Button>
                          )}
                          {alert.acknowledged && (
                            <span className="text-[10px] md:text-xs text-green-600 flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Ack'd
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
