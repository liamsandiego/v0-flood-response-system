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
    <div className="flex items-center justify-between gap-2 py-2 overflow-hidden">
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 min-w-0 min-h-[44px] py-2 transition-colors ${
          enabled ? accentColor : "text-muted-foreground"
        }`}
      >
        {enabled ? <Eye className="h-4 w-4 shrink-0" /> : <EyeOff className="h-4 w-4 shrink-0" />}
        <span className={`h-5 w-5 shrink-0 ${enabled ? "" : "opacity-40"}`}>{icon}</span>
        <span className={`text-sm truncate ${enabled ? "font-medium" : "opacity-60"}`}>
          {label}
        </span>
      </button>

      <div className="flex items-center gap-1.5 shrink-0">
        {status !== "none" && <StatusDot status={status} />}
        {badge && (
          <span className="text-[9px] bg-muted text-muted-foreground border border-border rounded-full px-2 py-1 whitespace-nowrap">
            {badge}
          </span>
        )}
        <button
          onClick={onToggle}
          className={`text-xs px-3 py-1.5 min-h-[32px] min-w-[48px] rounded-full border transition-colors whitespace-nowrap ${
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
