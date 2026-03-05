"use client"

// =============================================================================
// RapidRelay – Rain Intensity Legend
// Shows color scale for RainViewer radar data interpretation.
// =============================================================================

import { RAIN_INTENSITY_LEGEND } from "@/lib/rainviewer"

interface LegendProps {
  visible: boolean
}

export function RainLegend({ visible }: LegendProps) {
  if (!visible) return null

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Rain Intensity
      </p>
      <div className="flex gap-0.5">
        {RAIN_INTENSITY_LEGEND.map((item) => (
          <div key={item.label} className="flex-1 text-center">
            <div
              className="h-2 rounded-sm mb-0.5"
              style={{ backgroundColor: item.color }}
            />
            <p className="text-[9px] text-muted-foreground leading-tight">{item.label}</p>
            <p className="text-[8px] text-muted-foreground/60">{item.mmh}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
