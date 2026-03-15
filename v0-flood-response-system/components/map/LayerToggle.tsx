"use client"

// =============================================================================
// RapidRelay – Layer Toggle
// Individual layer on/off switch with status indicator and optional badge.
// =============================================================================

import { Eye, EyeOff } from "lucide-react"

type StatusType = "online" | "loading" | "error" | "offline" | "none"

interface LayerToggleProps {
  /** Layer display name */
  label: string
  /** Icon element to display */
  icon: React.ReactNode
  /** Whether the layer is enabled */
  enabled: boolean
  /** Called when toggle is clicked */
  onToggle: () => void
  /** Status indicator */
  status?: StatusType
  /** Small badge text (e.g. "Phase 2", "Free") */
  badge?: string
  /** Icon color class when enabled */
  accentColor?: string
}

function StatusDot({ status }: { status: StatusType }) {
  if (status === "none") return null

  const colors: Record<StatusType, string> = {
    online: "bg-green-400",
    loading: "bg-yellow-400 animate-pulse",
    error: "bg-red-400",
    offline: "bg-gray-400",
    none: "",
  }

  const labels: Record<StatusType, string> = {
    online: "Online",
    loading: "Loading",
    error: "Error",
    offline: "Offline",
    none: "",
  }

  return (
    <div className="flex items-center gap-1" title={labels[status]}>
      <div className={`h-1.5 w-1.5 rounded-full ${colors[status]}`} />
      <span className="text-[9px] text-muted-foreground">{labels[status]}</span>
    </div>
  )
}

export function LayerToggle({
  label,
  icon,
  enabled,
  onToggle,
  status = "none",
  badge,
  accentColor = "text-primary",
}: LayerToggleProps) {
  return (
    <div className="flex items-center justify-between gap-1.5 py-1 overflow-hidden">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 min-w-0 transition-colors ${
          enabled ? accentColor : "text-muted-foreground"
        }`}
      >
        {enabled ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
        <span className={`h-4 w-4 shrink-0 ${enabled ? "" : "opacity-40"}`}>{icon}</span>
        <span className={`text-xs truncate ${enabled ? "font-medium" : "opacity-60"}`}>
          {label}
        </span>
      </button>

      <div className="flex items-center gap-1 shrink-0">
        {status !== "none" && <StatusDot status={status} />}
        {badge && (
          <span className="text-[8px] bg-muted text-muted-foreground border border-border rounded-full px-1.5 py-0.5 whitespace-nowrap">
            {badge}
          </span>
        )}
        <button
          onClick={onToggle}
          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
            enabled
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted border-border text-muted-foreground"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  )
}
