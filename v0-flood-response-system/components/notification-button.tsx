"use client"

import { useNotifications } from "@/hooks/use-notifications"
import { Button } from "@/components/ui/button"
import { Bell, BellOff, BellRing } from "lucide-react"

/**
 * Notification permission button with clear status indication.
 * Only shows on supported browsers.
 */
export function NotificationButton() {
  const { supported, permission, requestPermission } = useNotifications()

  if (!supported) return null

  if (permission === "granted") {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1 text-green-600">
        <BellRing className="h-4 w-4" />
        <span className="hidden sm:inline">Notifications On</span>
      </Button>
    )
  }

  if (permission === "denied") {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1 text-red-500">
        <BellOff className="h-4 w-4" />
        <span className="hidden sm:inline">Blocked</span>
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={requestPermission}
      className="gap-1"
    >
      <Bell className="h-4 w-4" />
      <span className="hidden sm:inline">Enable Alerts</span>
    </Button>
  )
}
