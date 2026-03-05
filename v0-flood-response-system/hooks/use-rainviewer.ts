"use client"

// =============================================================================
// RapidRelay – useRainViewer hook (v2)
//
// Uses lib/rainviewer.ts API client with retry + caching.
// Provides animation controls, frame navigation, auto-refresh every 10 min.
// Properly cancels in-flight fetches via AbortController.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react"
import {
  fetchRainViewerData,
  buildTileUrl,
  formatFrameTime,
  formatFrameRelative,
  type RainViewerFrame,
  type RainViewerData,
} from "@/lib/rainviewer"

export type { RainViewerFrame, RainViewerData }

export interface UseRainViewerReturn {
  frames: RainViewerFrame[]
  nowIndex: number
  currentFrameIndex: number
  setFrameIndex: (index: number) => void
  nextFrame: () => void
  prevFrame: () => void
  jumpToLatest: () => void
  getTileUrl: (frame: RainViewerFrame, colorScheme: number, smooth: boolean, snow: boolean) => string
  formatTime: (frame: RainViewerFrame) => string
  formatRelative: (frame: RainViewerFrame) => string
  loading: boolean
  error: string | null
  lastUpdated: number | null
  retry: () => void
  host: string
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000

export function useRainViewer(): UseRainViewerReturn {
  const [data, setData] = useState<RainViewerData | null>(null)
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchFrames = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      setLoading(true)
      setError(null)

      const rvData = await fetchRainViewerData(controller.signal)
      if (!mountedRef.current) return

      setData(rvData)
      setLastUpdated(Date.now())

      // Default to latest past frame
      const pastCount = rvData.past.length
      if (pastCount > 0) {
        setCurrentFrameIndex(pastCount - 1)
      }
    } catch (err: any) {
      if (err.name === "AbortError") return
      if (!mountedRef.current) return
      console.error("[useRainViewer] Fetch error:", err)
      setError(err.message ?? "Failed to load radar data")
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // ── Lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    fetchFrames()
    const interval = setInterval(fetchFrames, REFRESH_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      clearInterval(interval)
    }
  }, [fetchFrames])

  // ── Derived ────────────────────────────────────────────────────────────
  const past = data?.past ?? []
  const nowcast = data?.nowcast ?? []
  const frames = [...past, ...nowcast]
  const nowIndex = past.length > 0 ? past.length - 1 : 0
  const host = data?.host ?? "https://tilecache.rainviewer.com"

  // ── Navigation ─────────────────────────────────────────────────────────
  const setFrameIndex = useCallback(
    (index: number) => {
      if (frames.length === 0) return
      setCurrentFrameIndex(Math.max(0, Math.min(index, frames.length - 1)))
    },
    [frames.length]
  )

  const nextFrame = useCallback(() => {
    setCurrentFrameIndex((prev) =>
      frames.length === 0 ? 0 : (prev + 1) % frames.length
    )
  }, [frames.length])

  const prevFrame = useCallback(() => {
    setCurrentFrameIndex((prev) =>
      frames.length === 0 ? 0 : (prev - 1 + frames.length) % frames.length
    )
  }, [frames.length])

  const jumpToLatest = useCallback(() => {
    setCurrentFrameIndex(nowIndex)
  }, [nowIndex])

  // ── Tile URL ───────────────────────────────────────────────────────────
  const getTileUrl = useCallback(
    (frame: RainViewerFrame, colorScheme: number, smooth: boolean, snow: boolean): string =>
      buildTileUrl(host, frame, colorScheme, smooth, snow),
    [host]
  )

  return {
    frames,
    nowIndex,
    currentFrameIndex,
    setFrameIndex,
    nextFrame,
    prevFrame,
    jumpToLatest,
    getTileUrl,
    formatTime: formatFrameTime,
    formatRelative: formatFrameRelative,
    loading,
    error,
    lastUpdated,
    retry: fetchFrames,
    host,
  }
}
