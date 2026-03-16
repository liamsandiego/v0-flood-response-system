"use client"

// =============================================================================
// RapidRelay – Animation Controls
// Play/Pause, speed selection, step ±10min/±1hr, jump to latest.
// =============================================================================

import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight } from "lucide-react"

interface AnimationControlsProps {
  /** Whether animation is currently playing */
  playing: boolean
  /** Current speed in ms per frame */
  speed: number
  /** Toggle play/pause */
  onTogglePlay: () => void
  /** Set animation speed */
  onSetSpeed: (ms: number) => void
  /** Step to previous frame */
  onPrev: () => void
  /** Step to next frame */
  onNext: () => void
  /** Jump backward N frames (e.g. 6 = 1 hour if 10min intervals) */
  onJumpBack?: () => void
  /** Jump forward N frames */
  onJumpForward?: () => void
  /** Jump to latest/now frame */
  onJumpToLatest: () => void
  /** Accent color for active state */
  accentBg?: string
  accentBorder?: string
}

const SPEED_OPTIONS = [
  { label: "0.5×", ms: 1000 },
  { label: "1×", ms: 500 },
  { label: "2×", ms: 250 },
] as const

export function AnimationControls({
  playing,
  speed,
  onTogglePlay,
  onSetSpeed,
  onPrev,
  onNext,
  onJumpBack,
  onJumpForward,
  onJumpToLatest,
  accentBg = "bg-cyan-500",
  accentBorder = "border-cyan-500",
}: AnimationControlsProps) {
  return (
    <div className="space-y-2">
      {/* Main transport controls */}
      <div className="flex items-center gap-1.5">
        {onJumpBack && (
          <button
            onClick={onJumpBack}
            className="flex items-center justify-center rounded border border-border px-2 py-2 min-h-[44px] min-w-[44px] hover:bg-muted transition-colors"
            title="Jump back 1 hour"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={onPrev}
          className="flex-1 flex items-center justify-center rounded border border-border px-2 py-2 min-h-[44px] hover:bg-muted transition-colors"
          title="Previous frame (−10 min)"
        >
          <SkipBack className="h-4 w-4" />
        </button>

        <button
          onClick={onTogglePlay}
          className={`flex-1 flex items-center justify-center rounded border px-2 py-2 min-h-[44px] transition-colors ${
            playing
              ? `${accentBg} text-white ${accentBorder}`
              : "border-border hover:bg-muted"
          }`}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        <button
          onClick={onNext}
          className="flex-1 flex items-center justify-center rounded border border-border px-2 py-2 min-h-[44px] hover:bg-muted transition-colors"
          title="Next frame (+10 min)"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        {onJumpForward && (
          <button
            onClick={onJumpForward}
            className="flex items-center justify-center rounded border border-border px-2 py-2 min-h-[44px] min-w-[44px] hover:bg-muted transition-colors"
            title="Jump forward 1 hour"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={onJumpToLatest}
          className="text-xs rounded border border-border px-3 py-2 min-h-[44px] hover:bg-muted transition-colors font-medium"
          title="Jump to latest"
        >
          Latest
        </button>
      </div>

      {/* Speed selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-12 shrink-0">Speed</span>
        <div className="flex gap-1.5 flex-1">
          {SPEED_OPTIONS.map(({ label, ms }) => (
            <button
              key={label}
              onClick={() => onSetSpeed(ms)}
              className={`flex-1 text-xs rounded border px-2 py-1.5 min-h-[36px] transition-colors ${
                speed === ms
                  ? `${accentBg} text-white ${accentBorder}`
                  : "border-border hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
