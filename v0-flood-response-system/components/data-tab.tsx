"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Download, ChevronLeft, ChevronRight, Search, Database, FileSpreadsheet,
} from "lucide-react"
import { supabasePublic } from "@/lib/supabase"

interface SupabaseRawReading {
  id: number
  "Date": string | null
  "Time": string | null
  "Soil Moisture": number | null
  "Temperature": number | null
  "Humidity": number | null
  "Pressure": number | null
  "Final Distance": number | null
  "Device": string | null
}

interface EnvironmentalRecord {
  id: number
  timestamp: string | null
  soil: number
  temperature: number
  humidity: number
  pressure: number
  distance_m: number | null
  device: string
}

const PAGE_SIZE = 25
const MAX_RECORDS = 1000
const REFRESH_INTERVAL_MS = 20_000
const POLL_FETCH_LIMIT = 200

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
})

function composeTimestamp(dateValue: string | null, timeValue: string | null): string | null {
  if (dateValue && timeValue) return `${dateValue}T${timeValue}`
  if (dateValue) return `${dateValue}T00:00:00`
  return null
}

function normalizeReading(raw: SupabaseRawReading): EnvironmentalRecord {
  return {
    id: raw.id,
    timestamp: composeTimestamp(raw["Date"], raw["Time"]),
    soil: raw["Soil Moisture"] ?? 0,
    temperature: raw["Temperature"] ?? 0,
    humidity: raw["Humidity"] ?? 0,
    pressure: raw["Pressure"] ?? 0,
    distance_m: raw["Final Distance"],
    device: raw["Device"] ?? "obando-main",
  }
}

function toMillis(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sortRecords(records: EnvironmentalRecord[]): EnvironmentalRecord[] {
  return [...records].sort((a, b) => {
    const bTime = toMillis(b.timestamp)
    const aTime = toMillis(a.timestamp)

    if (bTime == null && aTime == null) return b.id - a.id
    if (bTime == null) return -1
    if (aTime == null) return 1

    const delta = bTime - aTime
    if (delta !== 0) return delta
    return b.id - a.id
  })
}

function mergeRecords(prev: EnvironmentalRecord[], incoming: EnvironmentalRecord[]): EnvironmentalRecord[] {
  const merged = new Map<number, EnvironmentalRecord>()
  for (const row of prev) merged.set(row.id, row)
  for (const row of incoming) merged.set(row.id, row)
  return sortRecords(Array.from(merged.values())).slice(0, MAX_RECORDS)
}

function formatTimestamp(value: string | null): string {
  const ms = toMillis(value)
  if (ms == null) return "—"
  return TIMESTAMP_FORMATTER.format(new Date(ms))
}

// Module-level cache to persist data across tab switches
let cachedRecords: EnvironmentalRecord[] = []
let dataLoaded = false

// Derive status from distance (water level) thresholds
function deriveStatus(r: EnvironmentalRecord): "normal" | "warning" | "critical" {
  const waterLevel = r.distance_m ?? 0
  if (waterLevel >= 2.5) return "critical"
  if (waterLevel >= 1.5) return "warning"
  return "normal"
}

function getStatusBadge(status: "normal" | "warning" | "critical") {
  if (status === "critical") return <Badge className="bg-red-500 text-white text-[10px] px-1.5">CRITICAL</Badge>
  if (status === "warning") return <Badge className="bg-yellow-500 text-black text-[10px] px-1.5">WARNING</Badge>
  return <Badge className="bg-green-500 text-white text-[10px] px-1.5">NORMAL</Badge>
}

export function DataTab() {
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "normal" | "warning" | "critical">("all")
  const [page, setPage] = useState(1)
  const [records, setRecords] = useState<EnvironmentalRecord[]>(cachedRecords)
  const [loading, setLoading] = useState(!dataLoaded)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const fetchingRef = useRef(false)
  const channelRef = useRef<ReturnType<typeof supabasePublic.channel> | null>(null)

  const fetchData = useCallback(async (initial = false) => {
    if (fetchingRef.current) return
    fetchingRef.current = true

    if (initial && cachedRecords.length === 0) {
      setLoading(true)
    }

    try {
      const { data, error } = await supabasePublic
        .from("obando_environmental_data")
        .select('id, "Date", "Time", "Soil Moisture", "Temperature", "Humidity", "Pressure", "Final Distance", "Device"')
        .order("Date", { ascending: false, nullsFirst: false })
        .order("Time", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(initial ? MAX_RECORDS : POLL_FETCH_LIMIT)

      if (error) {
        console.error("[DataTab] Failed to fetch sensor data:", error)
      } else if (data) {
        const incoming = sortRecords((data as SupabaseRawReading[]).map(normalizeReading))
        cachedRecords = initial
          ? incoming.slice(0, MAX_RECORDS)
          : mergeRecords(cachedRecords, incoming)

        dataLoaded = true
        setRecords(cachedRecords)
        setLastSyncedAt(new Date())
      }
    } catch (err) {
      console.error("[DataTab] Error fetching data:", err)
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (cachedRecords.length > 0) {
      setRecords(cachedRecords)
      setLoading(false)
    }

    void fetchData(!dataLoaded)

    const interval = window.setInterval(() => {
      void fetchData(false)
    }, REFRESH_INTERVAL_MS)

    const onFocus = () => {
      if (document.visibilityState === "visible") {
        void fetchData(false)
      }
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    // Realtime: merge inserts/updates into cached records while preserving sort.
    if (!channelRef.current) {
      channelRef.current = supabasePublic
        .channel("environmental-data-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "obando_environmental_data" },
          (payload: any) => {
            const eventType = payload?.eventType as string | undefined
            if (eventType === "DELETE") {
              const deletedId = Number(payload?.old?.id)
              if (Number.isFinite(deletedId)) {
                cachedRecords = cachedRecords.filter((r) => r.id !== deletedId)
                setRecords(cachedRecords)
              }
              return
            }

            const incoming = normalizeReading(payload.new as SupabaseRawReading)
            cachedRecords = mergeRecords(cachedRecords, [incoming])
            setRecords(cachedRecords)
            setLastSyncedAt(new Date())
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            void fetchData(false)
          }
        })
    }

    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      if (channelRef.current) {
        supabasePublic.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fetchData])

  useEffect(() => { setPage(1) }, [filter, statusFilter])

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const status = deriveStatus(r)
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (!filter) return true
      const text = filter.toLowerCase()
      const ts = formatTimestamp(r.timestamp).toLowerCase()
      const dist = (r.distance_m ?? 0).toFixed(2)
      return ts.includes(text) || status.includes(text) || dist.includes(text)
    })
  }, [records, filter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const exportCSV = () => {
    const headers = ["Timestamp", "Status", "Water Level (m)", "Soil (%)", "Humidity (%)", "Temperature (°C)", "Pressure (hPa)"]
    const rows = filtered.map((r) => {
      const status = deriveStatus(r)
      const timestampMs = toMillis(r.timestamp)
      const isoTimestamp = timestampMs != null && r.timestamp
        ? new Date(r.timestamp).toISOString()
        : ""
      return [
        isoTimestamp,
        status.toUpperCase(),
        (r.distance_m ?? "").toString(),
        r.soil.toString(),
        r.humidity.toString(),
        r.temperature.toString(),
        r.pressure.toString(),
      ]
    })
    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `rapidrelay-data-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Environmental Data
            </CardTitle>
            <CardDescription className="mt-1">
              {loading ? "Loading..." : `${filtered.length} record${filtered.length !== 1 ? "s" : ""}`} • Synced from Supabase
              {lastSyncedAt ? ` • Last sync ${TIMESTAMP_FORMATTER.format(lastSyncedAt)} (local)` : ""}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by timestamp, status..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full h-8 rounded-md border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "normal", "warning", "critical"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-[10px] rounded-md border px-2 py-1 transition-colors capitalize ${
                  statusFilter === s
                    ? s === "critical" ? "bg-red-500 text-white border-red-500"
                    : s === "warning" ? "bg-yellow-500 text-black border-yellow-500"
                    : s === "normal" ? "bg-green-500 text-white border-green-500"
                    : "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 border-border hover:bg-muted"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <div className="h-5 w-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mr-3" />
            <span className="text-sm">Loading data from Supabase...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSpreadsheet className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No records found</p>
            <p className="text-xs mt-1">Data will appear as sensor readings come in</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Timestamp</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Water (m)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Soil (%)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Humidity (%)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Temp (°C)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Pressure</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r, idx) => {
                  const status = deriveStatus(r)
                  return (
                    <tr key={r.id ?? `${r.timestamp}-${idx}`} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-muted-foreground">
                        {formatTimestamp(r.timestamp)}
                      </td>
                      <td className="px-3 py-2">{getStatusBadge(status)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.distance_m != null ? r.distance_m.toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.soil.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.humidity.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.temperature.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.pressure.toFixed(0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] px-2">Page {page}/{totalPages}</span>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
