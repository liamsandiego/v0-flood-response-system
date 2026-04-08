import { useEffect, useState, useRef } from "react"
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

// Module-level cache to persist data across tab switches
let cachedPredictions: FloodPrediction[] = []
let predictionsLoaded = false

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
  const [predictions, setPredictions] = useState<FloodPrediction[]>(cachedPredictions)
  const [loading, setLoading] = useState(!predictionsLoaded)
  const fetchingRef = useRef(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    // Skip if already fetching or data already loaded
    if (fetchingRef.current || predictionsLoaded) {
      setLoading(false)
      return
    }
    fetchingRef.current = true

    const fetchPredictions = async () => {
      try {
        const { data, error } = await supabase
          .from("flood_predictions")
          .select("id, timestamp, flood_probability, risk_tier, created_at")
          .order("timestamp", { ascending: false })
          .limit(100)

        if (error) {
          console.error("[AlertHistory] Failed to fetch predictions:", error)
        } else if (data) {
          cachedPredictions = data as FloodPrediction[]
          predictionsLoaded = true
          setPredictions(cachedPredictions)
          console.log(`[AlertHistory] Loaded ${data.length} predictions from flood_predictions`)
        }
      } catch (err) {
        console.error("[AlertHistory] Error fetching predictions:", err)
      } finally {
        setLoading(false)
        fetchingRef.current = false
      }
    }
    fetchPredictions()

    // Realtime: new predictions pushed live (only subscribe once)
    if (!channelRef.current) {
      channelRef.current = supabase
        .channel("flood-predictions-realtime")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "flood_predictions" },
          (payload: any) => {
            cachedPredictions = [payload.new as FloodPrediction, ...cachedPredictions].slice(0, 100)
            setPredictions(cachedPredictions)
          }
        )
        .subscribe()
    }

    return () => {
      // Don't unsubscribe on unmount - keep connection alive
    }
  }, [])

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
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <div className="h-5 w-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mr-3" />
            <span className="text-sm">Loading predictions from Supabase...</span>
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
