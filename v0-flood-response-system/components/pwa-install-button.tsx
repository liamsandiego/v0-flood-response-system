"use client"

import { usePwaInstall } from "@/hooks/use-pwa-install"
import { Button } from "@/components/ui/button"
import { Download, CheckCircle, Smartphone } from "lucide-react"

/**
 * PWA Install Button – always visible in the dashboard header.
 * Shows different states: installed, ready to install, or prompting
 * the user to use the browser menu.
 */
export function PwaInstallButton() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall()

  if (isInstalled) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1 text-green-600">
        <CheckCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Installed</span>
      </Button>
    )
  }

  if (canInstall) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={promptInstall}
        className="gap-1"
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">Install App</span>
      </Button>
    )
  }

  // Always show — even when beforeinstallprompt hasn't fired yet
  // (e.g. HTTP dev server, unsupported browser). Tapping opens a hint.
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1"
      onClick={() => {
        // Try to trigger the install prompt; if unavailable show a hint
        if (typeof window !== "undefined") {
          alert(
            "To install RapidRelay:\n\n" +
            "• Chrome/Edge: Click the install icon (⊕) in the address bar\n" +
            "• Safari: Tap Share → Add to Home Screen\n" +
            "• Firefox: Use the browser menu → Install\n\n" +
            "Note: The app must be served over HTTPS for native install."
          )
        }
      }}
    >
      <Smartphone className="h-4 w-4" />
      <span className="hidden sm:inline">Install App</span>
    </Button>
  )
}
