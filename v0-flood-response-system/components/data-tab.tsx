"use client"

// =============================================================================
// RapidRelay – Data Table with CSV Export
//
// Displays all sensor records in a filterable, paginated table.
// Export to CSV for offline analysis / reporting.
// Uses the same mock data source as the dashboard.
// =============================================================================

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Download, ChevronLeft, ChevronRight, Search, Database,
  TrendingUp, TrendingDown, Minus, Filter, FileSpreadsheet,
} from "lucide-react"
import type { SensorSnapshot } from "@/lib/types"

interface DataTabProps {
  /** Rolling history of snapshots from dashboard */
  history: SensorSnapshot[]
}

const PAGE_SIZE = 25

export function DataTab({ history }: DataTabProps) {
  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "normal" | "warning" | "critical">("all")
  const [page, setPage] = useState(1)

  // Reset page when filter changes
  useEffect(() => {
    setPage(1)
  }, [filter, statusFilter])

  // Filtered records
  const filtered = useMemo(() => {
    return history.filter((snap) => {
      // Status filter
      if (statusFilter !== "all" && snap.overallStatus !== statusFilter) return false
      // Text filter
      if (!filter) return true
      const text = filter.toLowerCase()
      const ts = snap.timestamp.toLocaleString().toLowerCase()
      const wl = snap.waterLevel.effectiveValue.toFixed(2)
      return (
        ts.includes(text) ||
        snap.overallStatus.includes(text) ||
        wl.includes(text)
      )
    })
  }, [history, filter, statusFilter])

  // Paginated
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  // CSV Export
  const exportCSV = () => {
    const headers = [
      "Timestamp",
      "Status",
      "Water Level (m)",
      "Rainfall (mm)",
      "Humidity (%)",
      "Soil Saturation (%)",
      "Flood Extent (%)",
      "Wetness Trend",
      "Risk Score (%)",
    ]

    const rows = filtered.map((snap) => [
      snap.timestamp.toISOString(),
      snap.overallStatus.toUpperCase(),
      (snap.waterLevel.effectiveValue).toFixed(3),
      snap.rainfall.toFixed(2),
      snap.humidity.effectiveValue.toFixed(1),
      (snap.soilMoisture.effectiveValue).toFixed(1),
      (snap.floodExtent * 100).toFixed(1),
      snap.wetnessTrend > 0 ? "Rising" : snap.wetnessTrend < 0 ? "Falling" : "Stable",
      (snap.risk * 100).toFixed(2),
    ])

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "critical":
        return <Badge className="bg-red-500 text-white text-[10px] px-1.5">CRITICAL</Badge>
      case "warning":
        return <Badge className="bg-yellow-500 text-black text-[10px] px-1.5">WARNING</Badge>
      default:
        return <Badge className="bg-green-500 text-white text-[10px] px-1.5">NORMAL</Badge>
    }
  }

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return <TrendingUp className="h-3.5 w-3.5 text-orange-500" />
    if (trend < 0) return <TrendingDown className="h-3.5 w-3.5 text-green-500" />
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />
  }

  const getRiskColor = (risk: number) => {
    if (risk > 0.7) return "text-red-500 font-bold"
    if (risk > 0.4) return "text-yellow-600 font-medium"
    return "text-green-500"
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Sensor Data Records
            </CardTitle>
            <CardDescription className="mt-1">
              {filtered.length} record{filtered.length !== 1 ? "s" : ""} •
              Session history (resets on page reload)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Filters Row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search records..."
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
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSpreadsheet className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No records yet</p>
            <p className="text-xs mt-1">Data will appear as sensor readings come in</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Time</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Water (m)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rain (mm)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Humidity</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Soil Sat</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Flood %</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">Trend</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Risk</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((snap, idx) => (
                  <tr
                    key={`${snap.timestamp.getTime()}-${idx}`}
                    className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-muted-foreground">
                      {snap.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="px-3 py-2">{getStatusBadge(snap.overallStatus)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {snap.waterLevel.effectiveValue.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {snap.rainfall.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {snap.humidity.effectiveValue.toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {snap.soilMoisture.effectiveValue.toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {(snap.floodExtent * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-center">
                      {getTrendIcon(snap.wetnessTrend)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${getRiskColor(snap.risk)}`}>
                      {(snap.risk * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
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
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] px-2">
                Page {page}/{totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
