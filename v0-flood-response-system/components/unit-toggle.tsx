"use client"

import { Button } from "@/components/ui/button"
import { Ruler } from "lucide-react"
import type { MeasurementUnit } from "@/lib/types"

interface UnitToggleProps {
  unit: MeasurementUnit
  onToggle: () => void
}

/**
 * Compact toggle button for switching between metric and imperial units.
 * Placed in the dashboard header alongside other controls.
 */
export function UnitToggle({ unit, onToggle }: UnitToggleProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      className="gap-1 min-w-[80px]"
      title={`Switch to ${unit === "metric" ? "imperial (feet)" : "metric (meters)"}`}
    >
      <Ruler className="h-4 w-4" />
      <span className="text-xs font-mono">{unit === "metric" ? "m" : "ft"}</span>
    </Button>
  )
}
