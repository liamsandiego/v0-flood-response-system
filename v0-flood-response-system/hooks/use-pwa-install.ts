"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * Hook to manage PWA installation prompt.
 * Captures the beforeinstallprompt event and exposes it as a callable action.
 */
export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    // Check if already installed (display-mode: standalone)
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setCanInstall(true)
    }

    window.addEventListener("beforeinstallprompt", handler)

    // Listen for successful install
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true)
      setCanInstall(false)
      deferredPrompt.current = null
    })

    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt.current) return false

    try {
      await deferredPrompt.current.prompt()
      const { outcome } = await deferredPrompt.current.userChoice

      if (outcome === "accepted") {
        setCanInstall(false)
        deferredPrompt.current = null
        return true
      }
    } catch (err) {
      console.error("[PWA] Install prompt failed:", err)
    }

    return false
  }, [])

  return { canInstall, isInstalled, promptInstall }
}
