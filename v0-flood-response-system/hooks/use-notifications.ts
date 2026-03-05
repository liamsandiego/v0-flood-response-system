"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { AlertLevel } from "@/lib/types"

const NOTIF_COOLDOWN_MS = 30_000 // 30 seconds minimum between same-type notifs

/**
 * Hook for managing push notification permissions and sending
 * browser notifications for flood alerts.
 *
 * Design decisions:
 * - Only requests permission on explicit user action (not on load)
 * - Only sends notifications for warning/critical (no spam for normal)
 * - Rate-limits notifications to prevent overwhelming the user
 */
export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default")
  const [supported, setSupported] = useState(false)

  // Stable ref for cooldown tracking — survives re-renders without
  // triggering dependency changes (this was the root cause of the
  // infinite re-render loop: the old useCallback()() pattern created
  // a new object every render → sendNotification became unstable →
  // dashboard useEffect re-fired → setState → re-render → loop)
  const lastNotifTimeRef = useRef<Record<string, number>>({})
  const supportedRef = useRef(false)
  const permissionRef = useRef<NotificationPermission>("default")

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setSupported(true)
      supportedRef.current = true
      setPermission(Notification.permission)
      permissionRef.current = Notification.permission
    }
  }, [])

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!supportedRef.current) return "denied"

    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      permissionRef.current = result
      return result
    } catch {
      // Safari fallback (callback-based API)
      return new Promise((resolve) => {
        Notification.requestPermission((result) => {
          setPermission(result)
          permissionRef.current = result
          resolve(result)
        })
      })
    }
  }, [])

  // sendNotification is intentionally dependency-free (reads from refs)
  // so it never changes identity and never re-triggers consumer useEffects
  const sendNotification = useCallback(
    (title: string, body: string, level: AlertLevel) => {
      if (!supportedRef.current || permissionRef.current !== "granted") return
      if (level === "normal") return

      const key = `${level}:${title}`
      const now = Date.now()
      const store = lastNotifTimeRef.current
      if (store[key] && now - store[key] < NOTIF_COOLDOWN_MS) return
      store[key] = now

      try {
        const icon = level === "critical" ? "/icons/icon-192x192.png" : "/icons/icon-96x96.png"

        const notification = new Notification(title, {
          body,
          icon,
          badge: "/icons/icon-192x192.png",
          tag: key,
          requireInteraction: level === "critical",
          silent: false,
        })

        if (level === "warning") {
          setTimeout(() => notification.close(), 10_000)
        }
      } catch (e) {
        console.error("[Notifications] Failed to send:", e)
      }
    },
    [] // no deps — reads from refs only
  )

  return {
    supported,
    permission,
    requestPermission,
    sendNotification,
  }
}
