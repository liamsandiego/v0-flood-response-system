"use client"

// =============================================================================
// RapidRelay – Animation Controls (Ultra-Compact)
// Minimal footprint: play/pause + step + speed in tight layout.
// =============================================================================

import { Play, Pause, ChevronLeft, ChevronRight } from "lucide-react"

interface AnimationControlsProps {
  playing: boolean
  speed: number
  onTogglePlay: () => void
  onSetSpeed: (ms: number) => void
  onPrev: () => void
  onNext: () => void
  onJumpBack?: () => void
  onJumpForward?: () => void
  onJumpToLatest: () => void
  accentBg?: string
  accentBorder?: string
}

const SPEED_OPTIONS = [
  { label: "½×", ms: 1000 },
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
  onJumpToLatest,
  accentBg = "bg-cyan-500",
}: AnimationControlsProps) {
  return (
    <div className="flex items-center gap-1">
      {/* Transport: < ▶ > */}
      <button
        onClick={onPrev}
        className="flex items-center justify-center rounded border border-border h-7 w-7 hover:bg-muted transition-colors"
        title="Previous"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={onTogglePlay}
        className={`flex items-center justify-center rounded border h-7 w-8 transition-colors ${
          playing ? `${accentBg} text-white border-transparent` : "border-border hover:bg-muted"
        }`}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <button
        onClick={onNext}
        className="flex items-center justify-center rounded border border-border h-7 w-7 hover:bg-muted transition-colors"
        title="Next"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-border mx-0.5" />

      {/* Speed: ½× 1× 2× */}
      {SPEED_OPTIONS.map(({ label, ms }) => (
        <button
          key={label}
          onClick={() => onSetSpeed(ms)}
          className={`text-[10px] font-medium rounded h-7 w-7 transition-colors ${
            speed === ms ? `${accentBg} text-white` : "bg-muted/50 hover:bg-muted text-muted-foreground"
          }`}
        >
          {label}
        </button>
      ))}

      {/* Divider */}
      <div className="w-px h-5 bg-border mx-0.5" />

      {/* Latest */}
      <button
        onClick={onJumpToLatest}
        className="text-[10px] font-medium rounded border border-border h-7 px-2 hover:bg-muted transition-colors"
        title="Jump to latest"
      >
        Latest
      </button>
    </div>
  )
}
