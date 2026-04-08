"use client"

// =============================================================================
// RapidRelay – Time Scrubber (Compact)
// Clean slider with time display and frame counter.
// Step buttons moved to AnimationControls to avoid duplication.
// =============================================================================

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
  /** Accent color class (e.g. "accent-cyan-400") */
  accentClass?: string
  // Legacy props - kept for compatibility but no longer used
  onStepBack?: () => void
  onStepForward?: () => void
}

export function TimeScrubber({
  currentIndex,
  totalFrames,
  nowIndex,
  timeLabel,
  relativeLabel,
  isForecast,
  onIndexChange,
  accentClass = "accent-cyan-400",
}: TimeScrubberProps) {
  if (totalFrames === 0) return null

  return (
    <div className="space-y-1.5">
      {/* Time display row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-mono font-semibold truncate">{timeLabel}</span>
          {relativeLabel && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              ({relativeLabel})
            </span>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
          isForecast
            ? "bg-amber-500/20 text-amber-400"
            : "bg-cyan-500/20 text-cyan-400"
        }`}>
          {isForecast ? "Forecast" : "Observed"}
        </span>
      </div>

      {/* Slider row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentIndex}
            onChange={(e) => onIndexChange(Number(e.target.value))}
            className={`w-full h-2 cursor-pointer rounded-full ${accentClass}`}
            style={{ touchAction: "none" }}
          />
          {/* Now marker on the slider track */}
          {nowIndex >= 0 && totalFrames > 1 && (
            <div
              className="absolute top-0 w-0.5 h-2 bg-white/60 pointer-events-none rounded"
              style={{ left: `${(nowIndex / (totalFrames - 1)) * 100}%` }}
            />
          )}
        </div>

        <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
          {currentIndex + 1}/{totalFrames}
        </span>
      </div>
    </div>
  )
}
