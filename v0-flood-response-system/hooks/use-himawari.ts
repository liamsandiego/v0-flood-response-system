"use client"

// =============================================================================
// RapidRelay – useHimawari hook (Zoom Earth pattern)
//
// Returns ALL frames with pre-computed URLs + an activeIndex.
// The map renders ALL sources permanently and only toggles raster-opacity.
// No source teardown, no tile re-fetch — smooth like Zoom Earth.
// =============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import {
  generateHimawariFrames,
  getHimawariMaxZoom,
  type HimawariFrame,
} from "@/lib/himawari"

export type { HimawariFrame }

export interface UseHimawariReturn {
  /** All frames with pre-computed URLs (mount all as permanent sources) */
  frames: HimawariFrame[]
  /** Index of the currently visible frame */
  activeIndex: number
  /** Max zoom for current product */
  maxZoom: number
  /** Navigation */
  nextFrame: () => void
  prevFrame: () => void
  setFrameIndex: (index: number) => void
  jumpToLatest: () => void
  /** Label for current frame */
  relativeLabel: string
}

export function useHimawari(
  product: "infrared" | "visible",
  enabled: boolean,
  animating: boolean,
  animationSpeed: number
): UseHimawariReturn {
  // Generate all frames with URLs — regenerate when product changes
  const frames = useMemo(() => {
    if (!enabled) return []
    return generateHimawariFrames(product, 24) // 24 hourly frames (past 24h)
  }, [enabled, product])

  // Start at the latest frame
  const [activeIndex, setActiveIndex] = useState(0)
  const maxZoom = getHimawariMaxZoom(product)

  // Refs for stable callbacks
  const framesRef = useRef(frames)
  framesRef.current = frames
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex

  // Reset to latest frame when frames regenerate
  useEffect(() => {
    if (frames.length > 0) {
      setActiveIndex(frames.length - 1)
    }
  }, [frames])

  // Navigation — just changes the index, no URL swapping
  const nextFrame = useCallback(() => {
    const f = framesRef.current
    if (f.length === 0) return
    setActiveIndex((prev) => (prev + 1) % f.length)
  }, [])

  const prevFrame = useCallback(() => {
    const f = framesRef.current
    if (f.length === 0) return
    setActiveIndex((prev) => (prev - 1 + f.length) % f.length)
  }, [])

  const setFrameIndex = useCallback((index: number) => {
    const f = framesRef.current
    if (f.length === 0) return
    setActiveIndex(Math.max(0, Math.min(index, f.length - 1)))
  }, [])

  const jumpToLatest = useCallback(() => {
    setActiveIndex(framesRef.current.length - 1)
  }, [])

  // Animation loop — just increments the index
  useEffect(() => {
    if (!enabled || !animating || frames.length === 0) return
    const interval = setInterval(nextFrame, animationSpeed)
    return () => clearInterval(interval)
  }, [enabled, animating, animationSpeed, frames.length, nextFrame])

  const currentFrame = activeIndex >= 0 && activeIndex < frames.length
    ? frames[activeIndex]
    : null
  const relativeLabel = currentFrame?.label ?? ""

  return {
    frames,
    activeIndex,
    maxZoom,
    nextFrame,
    prevFrame,
    setFrameIndex,
    jumpToLatest,
    relativeLabel,
  }
}
