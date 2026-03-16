"use client"

import { useState } from "react"
import { usePwaInstall } from "@/hooks/use-pwa-install"
import { PwaInstallModal } from "@/components/pwa-install-modal"
import { Download, CheckCircle, Smartphone } from "lucide-react"

/**
 * PWA Install Button — opens a proper install modal with per-browser instructions.
 * On desktop: compact button in header. On mobile: shown in header + opens bottom sheet modal.
 */
export function PwaInstallButton({ compact = false }: { compact?: boolean }) {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall()
  const [modalOpen, setModalOpen] = useState(false)

  if (isInstalled) {
    return compact ? null : (
      <button className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-emerald-400 text-xs font-medium opacity-70 cursor-default">
        <CheckCircle className="h-4 w-4" />
        <span className="hidden sm:inline">Installed</span>
      </button>
    )
  }

  return (
    <>
      <button
        onClick={() => {
          if (canInstall) {
            promptInstall()
          } else {
            setModalOpen(true)
          }
        }}
        className={`flex items-center gap-1.5 rounded-lg font-medium transition-colors
          ${compact
            ? "h-10 w-10 justify-center bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30"
            : "px-3 py-2 text-xs bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30"
          }`}
        title="Install App"
      >
        {canInstall ? <Download className="h-4 w-4 flex-shrink-0" /> : <Smartphone className="h-4 w-4 flex-shrink-0" />}
        {!compact && <span>Install App</span>}
      </button>

      <PwaInstallModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onNativeInstall={promptInstall}
        canNativeInstall={canInstall}
      />
    </>
  )
}
