"use client"

// =============================================================================
// RapidRelay – Floating Panel
//
// Glassmorphism panel with:
//   - Drag handle (hold header to reposition, clamped inside parent)
//   - Resize grip (bottom-right corner)
//   - Minimize toggle (collapse to header-only)
//   - Optional close button
//
// Uses pointer events + refs for smooth 60fps dragging (no React re-renders).
// Drag is clamped to the parent container so panels can never escape or get
// stuck behind the header / footer / nav bars.
// =============================================================================

import { useRef, useState, useCallback } from "react"
import { Minus, Maximize2, GripHorizontal, X } from "lucide-react"

interface FloatingPanelProps {
  children: React.ReactNode
  title: string
  icon?: React.ReactNode
  className?: string
  defaultMinimized?: boolean
  onClose?: () => void
}

export function FloatingPanel({
  children,
  title,
  icon,
  className = "",
  defaultMinimized = false,
  onClose,
}: FloatingPanelProps) {
  const [minimized, setMinimized] = useState(defaultMinimized)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 })
  const resize = useRef({ active: false, sx: 0, sy: 0, ow: 0, oh: 0 })
  const pos = useRef({ x: 0, y: 0 })

  // ── Drag: pointer down on header ──
  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    const el = panelRef.current
    if (!el) return
    if ((e.target as HTMLElement).closest("button")) return

    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

    drag.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      ox: pos.current.x,
      oy: pos.current.y,
    }
  }, [])

  const onDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return
    const el = panelRef.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return

    const dx = e.clientX - drag.current.sx
    const dy = e.clientY - drag.current.sy
    let newX = drag.current.ox + dx
    let newY = drag.current.oy + dy

    // Clamp inside the parent container (the content area).
    // offsetLeft/offsetTop = panel's natural position before transform.
    const pw = parent.clientWidth
    const ph = parent.clientHeight
    const ew = el.offsetWidth
    const naturalLeft = el.offsetLeft
    const naturalTop = el.offsetTop

    // Horizontal: keep at least 80px visible inside parent
    const minX = -naturalLeft
    const maxX = pw - naturalLeft - Math.min(80, ew)
    newX = Math.max(minX, Math.min(maxX, newX))

    // Vertical: can't go above parent (would clip behind header),
    // and header (~30px) must stay visible at bottom
    const minY = -naturalTop
    const maxY = ph - naturalTop - 30
    newY = Math.max(minY, Math.min(maxY, newY))

    pos.current = { x: newX, y: newY }
    el.style.transform = `translate(${newX}px, ${newY}px)`
  }, [])

  const onDragPointerUp = useCallback(() => {
    drag.current.active = false
  }, [])

  // ── Resize: pointer down on resize grip ──
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    const el = panelRef.current
    if (!el) return

    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

    resize.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      ow: el.offsetWidth,
      oh: el.offsetHeight,
    }
  }, [])

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resize.current.active) return
    const el = panelRef.current
    if (!el) return

    const dx = e.clientX - resize.current.sx
    const dy = e.clientY - resize.current.sy

    const newW = Math.max(250, Math.min(window.innerWidth * 0.8, resize.current.ow + dx))
    const newH = Math.max(150, Math.min(window.innerHeight * 0.8, resize.current.oh + dy))

    el.style.width = `${newW}px`
    el.style.maxHeight = `${newH}px`
  }, [])

  const onResizePointerUp = useCallback(() => {
    resize.current.active = false
  }, [])

  return (
    <div
      ref={panelRef}
      className={`backdrop-blur-xl bg-slate-900/60 border border-white/10 rounded-xl shadow-2xl text-white min-h-0 overflow-hidden ${className}`}
      style={{ willChange: "transform" }}
    >
      {/* ── Drag handle header ── */}
      <div
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        className="flex items-center justify-between px-3 py-1.5 cursor-grab active:cursor-grabbing select-none touch-none shrink-0"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="h-3 w-3 text-white/20 shrink-0" />
          {icon}
          <span className="text-[11px] font-semibold text-white/70 uppercase tracking-wider truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setMinimized(!minimized)}
            className="h-8 w-8 flex items-center justify-center rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors"
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Content (hidden when minimized) ── */}
      {!minimized && (
        <div className="border-t border-white/5 flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {children}

          {/* ── Resize grip (bottom-right corner) ── */}
          <div
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            className="absolute bottom-0 right-0 w-8 h-8 cursor-se-resize touch-none z-10 group"
            title="Drag to resize"
          >
            <svg
              className="w-3.5 h-3.5 absolute bottom-1 right-1 text-white/20 group-hover:text-white/50 transition-colors"
              viewBox="0 0 10 10"
              fill="currentColor"
            >
              <circle cx="8" cy="8" r="1.2" />
              <circle cx="4" cy="8" r="1.2" />
              <circle cx="8" cy="4" r="1.2" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}
