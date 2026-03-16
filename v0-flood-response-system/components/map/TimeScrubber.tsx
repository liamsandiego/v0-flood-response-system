"use client"

// =============================================================================
// RapidRelay – Time Scrubber
// Slider with time display, past/forecast indicator, and time step buttons.
// Used for both RainViewer and Himawari overlays.
// =============================================================================

import { ChevronLeft, ChevronRight } from "lucide-react"

interface TimeScrubberProps {
  /** Current index in the frames array */
  currentIndex: number
  /** Total number of frames */
  totalFrames: number
  /** Index that separates past from forecast (or -1 if N/A) */
  nowIndex: number
  /** Display label for the current frame time */
  timeLabel: string
  /** Display label for relative time (e.g. "10 min ago") */
  relativeLabel?: string
  /** Whether current frame is a forecast */
  isForecast?: boolean
  /** Called when user moves the slider */
  onIndexChange: (index: number) => void
  /** Jump backward by N frames */
  onStepBack?: () => void
  /** Jump forward by N frames */
  onStepForward?: () => void
  /** Accent color class (e.g. "accent-cyan-400") */
  accentClass?: string
}

export function TimeScrubber({
  currentIndex,
  totalFrames,
  nowIndex,
  timeLabel,
  relativeLabel,
  isForecast,
  onIndexChange,
  onStepBack,
  onStepForward,
  accentClass = "accent-cyan-400",
}: TimeScrubberProps) {
  if (totalFrames === 0) return null

  return (
    <div className="space-y-1">
      {/* Time display row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-medium">{timeLabel}</span>
          {relativeLabel && (
            <span className="text-[10px] text-muted-foreground">({relativeLabel})</span>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          isForecast
            ? "bg-amber-500/20 text-amber-400"
            : "bg-cyan-500/20 text-cyan-400"
        }`}>
          {isForecast ? "Forecast" : "Observed"}
        </span>
      </div>

      {/* Slider + step buttons */}
      <div className="flex items-center gap-1.5">
        {onStepBack && (
          <button
            onClick={onStepBack}
            className="p-2.5 rounded hover:bg-muted transition-colors"
            title="Step back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        <div className="flex-1 relative">
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentIndex}
            onChange={(e) => onIndexChange(Number(e.target.value))}
            className={`w-full h-3 cursor-pointer ${accentClass}`}
            style={{ touchAction: "none" }} // better mobile UX
          />
          {/* Now marker on the slider track */}
          {nowIndex >= 0 && totalFrames > 1 && (
            <div
              className="absolute top-0 w-0.5 h-3 bg-white/60 pointer-events-none"
              style={{ left: `${(nowIndex / (totalFrames - 1)) * 100}%` }}
            />
          )}
        </div>

        {onStepForward && (
          <button
            onClick={onStepForward}
            className="p-2.5 rounded hover:bg-muted transition-colors"
            title="Step forward"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        <span className="text-xs font-mono text-muted-foreground w-10 text-right shrink-0">
          {currentIndex + 1}/{totalFrames}
        </span>
      </div>
    </div>
  )
}
