export type AlertLevel = "normal" | "warning" | "critical"

export interface SensorData {
  id: string
  name: string
  waterLevel: number
  rainfall: number
  status: AlertLevel
  lat: number
  lng: number
  lastUpdate: Date
}
