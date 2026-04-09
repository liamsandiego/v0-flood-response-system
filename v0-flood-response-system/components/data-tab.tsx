"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Download, ChevronLeft, ChevronRight, Search, Database, FileSpreadsheet,
} from "lucide-react"
import { supabasePublic } from "@/lib/supabase"

// Raw row from Supabase (actual column names with spaces/quotes)
interface SupabaseRawRecord {
  id: number
  "Soil Moisture": number
  "Temperature": number
  "Humidity": number
  "Pressure": number
  "Final Distance": number | null
  "Date": string | null
  "Time": string | null
  "Device": string | null
}

// Normalized record for internal use
interface EnvironmentalRecord {
  id: number
  timestamp: string
  soil: number
  temperature: number
  humidity: number
  pressure: number
  distance_m: number | null
  water_level_m: number | null
}

const DIKE_HEIGHT_M = 4.038

function calculateWaterLevel(distanceM: number | null): number | null {
  if (distanceM == null || distanceM < 0) return null
  return Math.max(0, DIKE_HEIGHT_M - distanceM)
}

// Convert raw Supabase row to normalized record
function normalizeRecord(raw: SupabaseRawRecord): EnvironmentalRecord {
  // Combine Date and Time into a timestamp
  let timestamp = new Date().toISOString()
  if (raw["Date"] && raw["Time"]) {
    timestamp = `${raw["Date"]}T${raw["Time"]}`
  } else if (raw["Date"]) {
    timestamp = `${raw["Date"]}T00:00:00`
  }

  return {
    id: raw.id,
    timestamp,
    soil: raw["Soil Moisture"],
    temperature: raw["Temperature"],
    humidity: raw["Humidity"],
    pressure: raw["Pressure"],
    distance_m: raw["Final Distance"],
    water_level_m: calculateWaterLevel(raw["Final Distance"]),
  }
}

const PAGE_SIZE = 25
const REFRESH_INTERVAL_MS = 20_000
const FETCH_TIMEOUT_MS = 12_000
const INITIAL_FETCH_LIMIT = 300
const POLL_FETCH_LIMIT = 120
const MAX_RECORDS = 1000
const DATA_CACHE_KEY = "rapidrelay:data-tab-cache:v1"
const DATA_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface DataCachePayload {
  updatedAt: number
  records: EnvironmentalRecord[]
}

function readDataCache(): EnvironmentalRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(DATA_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DataCachePayload
    if (!parsed?.updatedAt || !Array.isArray(parsed.records)) return []
    if (Date.now() - parsed.updatedAt > DATA_CACHE_MAX_AGE_MS) return []
    return parsed.records
  } catch {
    return []
  }
}

function writeDataCache(records: EnvironmentalRecord[]) {
  if (typeof window === "undefined") return
  try {
    const payload: DataCachePayload = {
      updatedAt: Date.now(),
      records,
    }
    window.localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore quota/storage failures; live data still works.
  }
}

function sortByNewest(records: EnvironmentalRecord[]) {
  return [...records].sort((a, b) => b.id - a.id)
}

function mergeRecords(prev: EnvironmentalRecord[], incoming: EnvironmentalRecord[]) {
  const map = new Map<number, EnvironmentalRecord>()
  for (const r of prev) map.set(r.id, r)
  for (const r of incoming) map.set(r.id, r)
  return sortByNewest(Array.from(map.values())).slice(0, MAX_RECORDS)
}

async function withHardTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

// Derive status from distance (water level) thresholds
function deriveStatus(r: EnvironmentalRecord): "normal" | "warning" | "critical" {
  const waterLevel = r.water_level_m ?? 0
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
  const [records, setRecords] = useState<EnvironmentalRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const hasHydratedCacheRef = useRef(false)
  const latestIdRef = useRef<number | null>(null)
  const channelRef = useRef<ReturnType<typeof supabasePublic.channel> | null>(null)

  const fetchData = useCallback(async (initial = false) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    if (initial && records.length === 0) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      let query = supabasePublic
        .from("obando_environmental_data")
        .select('id, "Soil Moisture", "Temperature", "Humidity", "Pressure", "Final Distance", "Date", "Time", "Device"')
        .abortSignal(controller.signal)
        .order("id", { ascending: false })

      if (!initial && latestIdRef.current != null) {
        query = query.gt("id", latestIdRef.current).limit(POLL_FETCH_LIMIT)
      } else {
        query = query.limit(INITIAL_FETCH_LIMIT)
      }

      const { data, error } = await withHardTimeout(
        query,
        FETCH_TIMEOUT_MS,
        "Supabase request timed out"
      )

      if (error) {
        console.error("[DataTab] Failed to fetch sensor data:", error)
        setFetchError(error.message ?? "Failed to fetch data")
      } else if (data) {
        const normalized = (data as SupabaseRawRecord[]).map(normalizeRecord)
        setRecords((prev) => {
          const next = initial || latestIdRef.current == null ? sortByNewest(normalized) : mergeRecords(prev, normalized)
          latestIdRef.current = next.length > 0 ? next[0].id : latestIdRef.current
          return next
        })
        setFetchError(null)
      }
    } catch (err) {
      console.error("[DataTab] Error fetching data:", err)
      const text = err instanceof Error ? err.message.toLowerCase() : ""
      const isTimeout = text.includes("timed out") || text.includes("abort")
      setFetchError(isTimeout ? "Request timed out. Retrying..." : "Network error while fetching data")
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
      setRefreshing(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedCacheRef.current) {
      const cachedRecords = readDataCache()
      if (cachedRecords.length > 0) {
        const cached = sortByNewest(cachedRecords).slice(0, MAX_RECORDS)
        setRecords(cached)
        latestIdRef.current = cached[0]?.id ?? null
        setLoading(false)
      }
      hasHydratedCacheRef.current = true
      fetchData(cachedRecords.length === 0)
    }

    // Polling fallback if realtime misses events/disconnects.
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS)

    // Refresh immediately when user returns to the tab/window.
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        fetchData()
      }
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    // Realtime: new rows pushed live (only subscribe once)
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
              setRecords((prev) => prev.filter((r) => r.id !== deletedId))
              return
            }

            const normalized = normalizeRecord(payload.new as SupabaseRawRecord)
            setRecords((prev) => mergeRecords(prev, [normalized]))
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            fetchData()
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            fetchData()
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

  useEffect(() => {
    if (!hasHydratedCacheRef.current) return
    latestIdRef.current = records[0]?.id ?? latestIdRef.current
    writeDataCache(records.slice(0, MAX_RECORDS))
  }, [records])

  useEffect(() => { setPage(1) }, [filter, statusFilter])

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const status = deriveStatus(r)
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (!filter) return true
      const text = filter.toLowerCase()
      const ts = new Date(r.timestamp).toLocaleString().toLowerCase()
      const water = (r.water_level_m ?? 0).toFixed(2)
      return ts.includes(text) || status.includes(text) || water.includes(text)
    })
  }, [records, filter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const exportCSV = () => {
    const headers = ["Timestamp", "Status", "Water Level (m)", "Soil (%)", "Humidity (%)", "Temperature (°C)", "Pressure (hPa)"]
    const rows = filtered.map((r) => {
      const status = deriveStatus(r)
      return [
        new Date(r.timestamp).toISOString(),
        status.toUpperCase(),
        (r.water_level_m ?? "").toString(),
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
              {loading ? "Loading..." : `${filtered.length} record${filtered.length !== 1 ? "s" : ""}`}
              {refreshing ? " • Refreshing..." : " • Synced from Supabase"}
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
        {loading && records.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <div className="h-5 w-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mr-3" />
            <span className="text-sm">Loading data from Supabase...</span>
          </div>
        ) : fetchError && records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSpreadsheet className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">Unable to load records right now</p>
            <p className="text-xs mt-1">{fetchError}</p>
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
                        {new Date(r.timestamp).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="px-3 py-2">{getStatusBadge(status)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.water_level_m != null ? r.water_level_m.toFixed(2) : "—"}</td>
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
