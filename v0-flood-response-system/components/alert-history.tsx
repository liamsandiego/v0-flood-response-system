import { useEffect, useState, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertTriangle, Droplets, Clock, ShieldAlert, TrendingUp } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { UserRole } from "@/components/auth-provider"

// Matches public.flood_predictions schema
interface FloodPrediction {
  id: string
  timestamp: string | null
  flood_probability: number | null
  risk_tier: string | null
  created_at: string | null
}

interface AlertHistoryProps {
  userRole: UserRole
}

const REFRESH_INTERVAL_MS = 20_000
const FETCH_TIMEOUT_MS = 12_000
const INITIAL_FETCH_LIMIT = 120
const POLL_FETCH_LIMIT = 30
const MAX_PREDICTIONS = 200
const HISTORY_CACHE_KEY = "rapidrelay:history-tab-cache:v1"
const HISTORY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface HistoryCachePayload {
  updatedAt: number
  predictions: FloodPrediction[]
}

function readHistoryCache(): FloodPrediction[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(HISTORY_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryCachePayload
    if (!parsed?.updatedAt || !Array.isArray(parsed.predictions)) return []
    if (Date.now() - parsed.updatedAt > HISTORY_CACHE_MAX_AGE_MS) return []
    return parsed.predictions
  } catch {
    return []
  }
}

function writeHistoryCache(predictions: FloodPrediction[]) {
  if (typeof window === "undefined") return
  try {
    const payload: HistoryCachePayload = {
      updatedAt: Date.now(),
      predictions,
    }
    window.localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore quota/storage failures; live data still works.
  }
}

function predictionTime(p: FloodPrediction): number {
  const raw = p.created_at ?? p.timestamp
  if (!raw) return 0
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : 0
}

function sortPredictions(predictions: FloodPrediction[]) {
  return [...predictions].sort((a, b) => predictionTime(b) - predictionTime(a))
}

function mergePredictions(prev: FloodPrediction[], incoming: FloodPrediction[]) {
  const map = new Map<string, FloodPrediction>()
  for (const p of prev) map.set(p.id, p)
  for (const p of incoming) map.set(p.id, p)
  return sortPredictions(Array.from(map.values())).slice(0, MAX_PREDICTIONS)
}

async function withHardTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function getRiskTierColor(tier: string | null) {
  const t = (tier || "").toLowerCase()
  if (t === "high" || t === "critical") return "bg-red-500 text-white"
  if (t === "moderate" || t === "medium" || t === "warning") return "bg-yellow-500 text-black"
  if (t === "low") return "bg-green-500 text-white"
  return "bg-blue-500 text-white"
}

function getRowBorder(tier: string | null) {
  const t = (tier || "").toLowerCase()
  if (t === "high" || t === "critical") return "border-red-400 bg-red-50 dark:bg-red-950/20"
  if (t === "moderate" || t === "medium") return "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/10"
  return "border-border"
}

function getProbabilityColor(prob: number) {
  if (prob >= 0.7) return "text-red-500 font-bold"
  if (prob >= 0.4) return "text-yellow-600 font-semibold"
  return "text-green-600"
}

export function AlertHistory({ userRole }: AlertHistoryProps) {
  const [predictions, setPredictions] = useState<FloodPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const fetchingRef = useRef(false)
  const hasHydratedCacheRef = useRef(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const fetchPredictions = useCallback(async (initial = false) => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    if (initial && predictions.length === 0) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      const { data, error } = await withHardTimeout(
        supabase
          .from("flood_predictions")
          .select("id, timestamp, flood_probability, risk_tier, created_at")
          .abortSignal(controller.signal)
          .order("created_at", { ascending: false })
          .limit(initial ? INITIAL_FETCH_LIMIT : POLL_FETCH_LIMIT),
        FETCH_TIMEOUT_MS,
        "Supabase request timed out"
      )

      if (error) {
        console.error("[AlertHistory] Failed to fetch predictions:", error)
        setFetchError(error.message ?? "Failed to fetch predictions")
      } else if (data) {
        const incoming = data as FloodPrediction[]
        setPredictions((prev) => (initial ? sortPredictions(incoming) : mergePredictions(prev, incoming)))
        setFetchError(null)
      }
    } catch (err) {
      console.error("[AlertHistory] Error fetching predictions:", err)
      const text = err instanceof Error ? err.message.toLowerCase() : ""
      const isTimeout = text.includes("timed out") || text.includes("abort")
      setFetchError(isTimeout ? "Request timed out. Retrying..." : "Network error while fetching predictions")
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
      setRefreshing(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!hasHydratedCacheRef.current) {
      const cachedPredictions = readHistoryCache()
      if (cachedPredictions.length > 0) {
        setPredictions(sortPredictions(cachedPredictions).slice(0, MAX_PREDICTIONS))
        setLoading(false)
      }
      hasHydratedCacheRef.current = true
      fetchPredictions(cachedPredictions.length === 0)
    }

    // Polling fallback if realtime misses events/disconnects.
    const interval = setInterval(fetchPredictions, REFRESH_INTERVAL_MS)

    // Refresh immediately when user returns to the tab/window.
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        fetchPredictions()
      }
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    // Realtime: new predictions pushed live (only subscribe once)
    if (!channelRef.current) {
      channelRef.current = supabase
        .channel("flood-predictions-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "flood_predictions" },
          (payload: any) => {
            const eventType = payload?.eventType as string | undefined
            if (eventType === "DELETE") {
              const deletedId = String(payload?.old?.id ?? "")
              setPredictions((prev) => prev.filter((p) => p.id !== deletedId))
              return
            }

            const incoming = payload.new as FloodPrediction
            setPredictions((prev) => mergePredictions(prev, [incoming]))
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            fetchPredictions()
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            fetchPredictions()
          }
        })
    }

    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fetchPredictions])

  useEffect(() => {
    if (!hasHydratedCacheRef.current) return
    writeHistoryCache(predictions.slice(0, MAX_PREDICTIONS))
  }, [predictions])

  const highRiskCount = predictions.filter((p) => {
    const t = (p.risk_tier || "").toLowerCase()
    return t === "high" || t === "critical"
  }).length

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base md:text-lg flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              Flood Prediction History
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {loading ? "Loading…" : `${predictions.length} prediction${predictions.length !== 1 ? "s" : ""}`}
              {refreshing && !loading && " • Refreshing..."}
              {highRiskCount > 0 && (
                <span className="text-red-500 font-semibold ml-1">
                  • {highRiskCount} high risk
                </span>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        {loading && predictions.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <div className="h-5 w-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mr-3" />
            <span className="text-sm">Loading predictions from Supabase...</span>
          </div>
        ) : fetchError && predictions.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Unable to load predictions right now.</p>
            <p className="text-xs mt-1 text-muted-foreground/60">{fetchError}</p>
          </div>
        ) : predictions.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No predictions yet.</p>
            <p className="text-xs mt-1 text-muted-foreground/60">The ML pipeline will log results here as they run.</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] md:h-[500px]">
            <div className="space-y-2 pr-2 md:pr-4">
              {predictions.map((p) => {
                const prob = p.flood_probability ?? 0
                const tier = p.risk_tier ?? "unknown"
                const ts = new Date(p.timestamp ?? p.created_at ?? "")
                const isHighRisk = ["high", "critical"].includes(tier.toLowerCase())

                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-3 md:p-4 transition-colors ${getRowBorder(tier)}`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0">
                        <div className={`flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full ${getRiskTierColor(tier)}`}>
                          {isHighRisk
                            ? <AlertTriangle className="h-4 w-4 md:h-5 md:w-5" />
                            : <Droplets className="h-4 w-4 md:h-5 md:w-5" />
                          }
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-start gap-1">
                          <p className="font-semibold text-xs md:text-sm flex-1 min-w-0">ML Flood Prediction</p>
                          <Badge variant="outline" className={`${getRiskTierColor(tier)} text-[10px] border-0`}>
                            {tier.toUpperCase()}
                          </Badge>
                        </div>

                        {/* Probability bar */}
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">Flood Probability</span>
                            <span className={`text-xs font-mono ${getProbabilityColor(prob)}`}>
                              {(prob * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                prob >= 0.7 ? "bg-red-500" : prob >= 0.4 ? "bg-yellow-500" : "bg-green-500"
                              }`}
                              style={{ width: `${Math.min(prob * 100, 100)}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-1 text-[10px] md:text-xs text-muted-foreground pt-0.5">
                          <Clock className="h-3 w-3" />
                          {isNaN(ts.getTime()) ? "—" : ts.toLocaleString()}
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
