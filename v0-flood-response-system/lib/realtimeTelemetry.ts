export type TelemetryEvent = {
  ts: string;
  type: string;
  message?: string;
  meta?: any;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

const KEY = 'rr.realtime.telemetry.v1'
const MAX_EVENTS = 500

export function getTelemetry(): TelemetryEvent[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as TelemetryEvent[]
  } catch {
    return []
  }
}

export function clearTelemetry() {
  try { localStorage.removeItem(KEY) } catch {}
}

export function logTelemetry(type: string, message?: string, meta?: any, level: TelemetryEvent['level'] = 'info') {
  try {
    const ev: TelemetryEvent = { ts: new Date().toISOString(), type, message, meta, level }
    const arr = getTelemetry()
    arr.unshift(ev)
    if (arr.length > MAX_EVENTS) arr.length = MAX_EVENTS
    localStorage.setItem(KEY, JSON.stringify(arr))
  } catch {}
}
