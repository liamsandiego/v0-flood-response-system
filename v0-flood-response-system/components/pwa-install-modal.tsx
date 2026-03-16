"use client"

// =============================================================================
// RapidRelay – PWA Install Modal
// Full-screen modal with per-browser step-by-step install instructions.
// Replaces the previous alert() fallback with a proper UX.
// =============================================================================

import { useState, useEffect } from "react"
import { X, Download, Smartphone, Chrome, MoreVertical, Share, Plus, CheckCircle } from "lucide-react"

type Browser = "chrome-android" | "samsung" | "firefox-android" | "safari-ios" | "edge-android" | "other"

function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other"
  const ua = navigator.userAgent

  if (/SamsungBrowser/i.test(ua)) return "samsung"
  if (/Firefox/i.test(ua) && /Android/i.test(ua)) return "firefox-android"
  if (/iPhone|iPad|iPod/i.test(ua) && /Safari/i.test(ua)) return "safari-ios"
  if (/Edg/i.test(ua) && /Android/i.test(ua)) return "edge-android"
  if (/Chrome/i.test(ua) && /Android/i.test(ua)) return "chrome-android"
  return "other"
}

const INSTRUCTIONS: Record<Browser, { title: string; steps: string[] }> = {
  "chrome-android": {
    title: "Install on Chrome (Android)",
    steps: [
      "Tap the ⋮ menu (three dots) in the top-right corner",
      'Tap "Add to Home screen" or "Install app"',
      'Tap "Add" to confirm',
      "RapidRelay will appear on your home screen",
    ],
  },
  samsung: {
    title: "Install on Samsung Internet",
    steps: [
      "Tap the ≡ menu (three lines) at the bottom right",
      'Tap "Add page to" then "Home screen"',
      'Tap "Add" to confirm',
      "RapidRelay will appear on your home screen",
    ],
  },
  "firefox-android": {
    title: "Install on Firefox (Android)",
    steps: [
      "Tap the ⋮ menu (three dots) in the top-right corner",
      'Tap "Install" or "Add to Home Screen"',
      'Tap "Add" to confirm',
      "RapidRelay will appear on your home screen",
    ],
  },
  "safari-ios": {
    title: "Install on Safari (iPhone/iPad)",
    steps: [
      "Tap the Share button (□ with ↑ arrow) at the bottom of Safari",
      'Scroll down and tap "Add to Home Screen"',
      'Edit the name if you like, then tap "Add"',
      "RapidRelay will appear on your home screen",
    ],
  },
  "edge-android": {
    title: "Install on Edge (Android)",
    steps: [
      "Tap the ⋯ menu (three dots) at the bottom",
      'Tap "Add to phone" or "Install app"',
      'Tap "Install" to confirm',
      "RapidRelay will appear on your home screen",
    ],
  },
  other: {
    title: "Add to Home Screen",
    steps: [
      "Open your browser's menu (⋮ or ≡)",
      'Look for "Add to Home Screen", "Install App", or similar',
      "Follow the prompts to install",
      "Note: App must be on HTTPS to install",
    ],
  },
}

interface PwaInstallModalProps {
  open: boolean
  onClose: () => void
  onNativeInstall?: () => Promise<boolean>
  canNativeInstall?: boolean
}

export function PwaInstallModal({
  open,
  onClose,
  onNativeInstall,
  canNativeInstall = false,
}: PwaInstallModalProps) {
  const [browser, setBrowser] = useState<Browser>("other")

  useEffect(() => {
    setBrowser(detectBrowser())
  }, [])

  if (!open) return null

  const { title, steps } = INSTRUCTIONS[browser]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative z-10 w-full sm:max-w-md mx-4 mb-0 sm:mb-0 bg-slate-900 border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-cyan-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <Smartphone className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Install RapidRelay</h2>
              <p className="text-xs text-white/50">Add to your home screen</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Native install button (if available) */}
        {canNativeInstall && onNativeInstall && (
          <div className="px-5 pt-4">
            <button
              onClick={async () => {
                const installed = await onNativeInstall()
                if (installed) onClose()
              }}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              <Download className="h-4 w-4" />
              Install Now (One Tap)
            </button>
            <div className="flex items-center gap-2 my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30">or follow these steps</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="px-5 pt-4 pb-6">
          <p className="text-sm font-semibold text-white/70 mb-3">{title}</p>
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 h-6 w-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-white/80 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-xs text-white/40">
              💡 Once installed, RapidRelay works like a native app — full screen, no browser bar, and works offline with cached data.
            </p>
          </div>

          <button
            onClick={onClose}
            className="mt-4 w-full py-3 text-sm text-white/60 hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
