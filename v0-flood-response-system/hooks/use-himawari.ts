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
  const frameCount = useMemo(() => {
    if (typeof navigator === "undefined") return 10
    const nav = navigator as Navigator & { deviceMemory?: number }
    const mem = nav.deviceMemory ?? 8
    const cores = navigator.hardwareConcurrency ?? 4

    // Keep animation visually continuous; avoid dropping to near-static frame counts.
    if (mem <= 4 || cores <= 4) return 10
    if (mem <= 8) return 12
    return 16
  }, [])

  // Generate all frames with URLs — regenerate when product changes
  const frames = useMemo(() => {
    if (!enabled) return []
    return generateHimawariFrames(product, frameCount)
  }, [enabled, product, frameCount])

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

  // Animation loop using requestAnimationFrame for smoother playback
  useEffect(() => {
    if (!enabled || !animating || frames.length === 0) return
    let lastTime = 0
    let rafId: number
    const tick = (timestamp: number) => {
      if (timestamp - lastTime >= animationSpeed) {
        nextFrame()
        lastTime = timestamp
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [enabled, animating, animationSpeed, frames.length, nextFrame])

  // Prefetch adjacent frames to keep animation smooth while scrubbing/playing.
  useEffect(() => {
    if (!enabled || frames.length === 0) return
    const prefetchIndices = [
      (activeIndex + 1) % frames.length,
      (activeIndex - 1 + frames.length) % frames.length,
    ]
    prefetchIndices.forEach((idx) => {
      const img = new Image()
      img.src = frames[idx].url
    })
  }, [enabled, activeIndex, frames])

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
