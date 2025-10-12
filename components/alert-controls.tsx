"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { MessageSquare, Radio, Share2, Send, AlertTriangle, CheckCircle, Bell, Loader2 } from "lucide-react"
import type { AlertLevel } from "@/lib/types"
import type { UserRole } from "@/components/auth-provider"
import type { SensorData } from "@/lib/types"

interface AlertControlsProps {
  currentStatus: AlertLevel
  userRole: UserRole
  sensors: SensorData[]
}

const QUICK_ALERTS = [
  {
    id: "flood-warning",
    title: "Flood Warning",
    message: "⚠️ FLOOD WARNING: Water levels are rising. Please stay alert and prepare for possible evacuation.",
    icon: AlertTriangle,
    variant: "warning" as const,
  },
  {
    id: "evacuation",
    title: "Evacuation Alert",
    message: "🚨 EVACUATION ALERT: Immediate evacuation required. Proceed to designated evacuation centers now.",
    icon: Bell,
    variant: "destructive" as const,
  },
  {
    id: "all-clear",
    title: "All Clear",
    message: "✅ ALL CLEAR: Water levels have receded. It is now safe to return to your homes.",
    icon: CheckCircle,
    variant: "default" as const,
  },
]

export function AlertControls({ currentStatus, userRole, sensors }: AlertControlsProps) {
  const [message, setMessage] = useState("")
  const [lastBroadcast, setLastBroadcast] = useState<string>("")
  const [broadcastHistory, setBroadcastHistory] = useState<Array<{ time: string; message: string; channels: string }>>(
    [],
  )
  const [isSendingSMS, setIsSendingSMS] = useState(false)
  const [isSendingSpeaker, setIsSendingSpeaker] = useState(false)
  const [isSendingSocial, setIsSendingSocial] = useState(false)
  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const { toast } = useToast()

  const broadcastAll = async () => {
    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message to broadcast",
        variant: "destructive",
      })
      return
    }

    setIsBroadcasting(true)
    const timestamp = new Date().toLocaleTimeString()
    const channels = "SMS, Speaker, Social Media"

    const criticalSensors = sensors.filter((s) => s.status === "critical")
    const warningSensors = sensors.filter((s) => s.status === "warning")

    let sensorInfo = ""
    if (criticalSensors.length > 0) {
      sensorInfo = `\n🔴 Critical: ${criticalSensors.map((s) => s.name).join(", ")}`
    }
    if (warningSensors.length > 0) {
      sensorInfo += `\n🟡 Warning: ${warningSensors.map((s) => s.name).join(", ")}`
    }

    toast({
      title: "🚀 Initiating Broadcast",
      description: `Preparing to send alert through all channels...${sensorInfo}`,
    })

    await new Promise((resolve) => setTimeout(resolve, 1500))
    toast({
      title: "📱 SMS Delivery",
      description: "Alert sent to 1,247 registered residents\n✓ Delivered: 1,198 | ⏳ Pending: 49",
    })

    await new Promise((resolve) => setTimeout(resolve, 1500))
    toast({
      title: "📢 Speaker System Active",
      description: "Broadcasting through 8 community speakers\n✓ All speakers operational",
    })

    await new Promise((resolve) => setTimeout(resolve, 1500))
    toast({
      title: "📱 Social Media Posted",
      description: "Posted to Facebook (2.3K followers), Twitter (1.8K), and 5 community groups",
    })

    setBroadcastHistory((prev) => [{ time: timestamp, message: message.trim(), channels }, ...prev.slice(0, 4)])

    setLastBroadcast(timestamp)
    setIsBroadcasting(false)

    toast({
      title: "✅ Broadcast Complete",
      description: `All channels successfully delivered at ${timestamp}`,
    })

    setMessage("")
  }

  const sendQuickAlert = (template: (typeof QUICK_ALERTS)[0]) => {
    setMessage(template.message)

    toast({
      title: `${template.title} Template Loaded`,
      description: "Review and click 'Broadcast to All Channels' to send",
    })
  }

  const sendSMSAlert = async () => {
    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message before sending SMS",
        variant: "destructive",
      })
      return
    }

    setIsSendingSMS(true)
    const timestamp = new Date().toLocaleTimeString()

    toast({
      title: "📱 Sending SMS...",
      description: "Connecting to SMS gateway...",
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    toast({
      title: "📱 SMS Processing",
      description: "Sending to 1,247 registered phone numbers...",
    })

    await new Promise((resolve) => setTimeout(resolve, 2000))

    const delivered = 1198
    const pending = 49
    const total = 1247

    toast({
      title: "✅ SMS Alert Sent",
      description: `Delivered: ${delivered}/${total} (${Math.round((delivered / total) * 100)}%)\nPending: ${pending}\nTime: ${timestamp}`,
    })

    setBroadcastHistory((prev) => [{ time: timestamp, message: message.trim(), channels: "SMS" }, ...prev.slice(0, 4)])

    setLastBroadcast(timestamp)
    setIsSendingSMS(false)
    setMessage("")
  }

  const activateSpeakerSystem = async () => {
    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message before activating speakers",
        variant: "destructive",
      })
      return
    }

    setIsSendingSpeaker(true)
    const timestamp = new Date().toLocaleTimeString()

    toast({
      title: "📢 Activating Speakers...",
      description: "Connecting to community speaker network...",
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    toast({
      title: "📢 Broadcasting Message",
      description: "8 speakers active across Barangay East Rembo...",
    })

    await new Promise((resolve) => setTimeout(resolve, 2500))

    toast({
      title: "✅ Speaker Broadcast Complete",
      description: `All 8 speakers operational\nLocations: Main Plaza, School, Market, Chapel, Gym, Park, Health Center, Barangay Hall\nTime: ${timestamp}`,
    })

    setBroadcastHistory((prev) => [
      { time: timestamp, message: message.trim(), channels: "Speaker System" },
      ...prev.slice(0, 4),
    ])

    setLastBroadcast(timestamp)
    setIsSendingSpeaker(false)
    setMessage("")
  }

  const postToSocialMedia = async () => {
    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message before posting",
        variant: "destructive",
      })
      return
    }

    setIsSendingSocial(true)
    const timestamp = new Date().toLocaleTimeString()

    toast({
      title: "📱 Posting to Social Media...",
      description: "Preparing posts for multiple platforms...",
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    toast({
      title: "📱 Publishing Posts",
      description: "Posting to Facebook, Twitter, and community groups...",
    })

    await new Promise((resolve) => setTimeout(resolve, 2000))

    toast({
      title: "✅ Social Media Posted",
      description: `✓ Facebook: Posted (2,347 followers)\n✓ Twitter: Posted (1,823 followers)\n✓ Community Groups: 5 groups notified\nTime: ${timestamp}`,
    })

    setBroadcastHistory((prev) => [
      { time: timestamp, message: message.trim(), channels: "Social Media" },
      ...prev.slice(0, 4),
    ])

    setLastBroadcast(timestamp)
    setIsSendingSocial(false)
    setMessage("")
  }

  const canUseQuickActions = userRole === "admin"

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Quick Alert Templates</CardTitle>
          <CardDescription>Use pre-defined messages for common emergency scenarios</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_ALERTS.map((alert) => {
              const Icon = alert.icon
              return (
                <Button
                  key={alert.id}
                  onClick={() => sendQuickAlert(alert)}
                  variant={alert.variant}
                  className="h-auto min-h-[100px] flex-col items-start gap-2 p-5 whitespace-normal text-left touch-manipulation"
                >
                  <div className="flex items-center gap-2 w-full">
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span className="font-semibold text-base">{alert.title}</span>
                  </div>
                  <span className="text-xs opacity-90 w-full">{alert.message}</span>
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Broadcast Alert</CardTitle>
          <CardDescription>Send manual alerts to residents via multiple channels</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="message">Alert Message</Label>
            <Textarea
              id="message"
              placeholder="Enter alert message for residents..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="text-base"
            />
          </div>
          <div className="grid gap-2">
            <Button
              onClick={broadcastAll}
              className="w-full h-12 text-base touch-manipulation"
              disabled={isBroadcasting}
            >
              {isBroadcasting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Broadcasting...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-5 w-5" />
                  Broadcast to All Channels
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            {canUseQuickActions ? "Send alerts through specific channels" : "Admin-only: Individual channel controls"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={sendSMSAlert}
            variant="outline"
            className="w-full h-12 justify-start bg-transparent text-base touch-manipulation"
            disabled={!canUseQuickActions || isSendingSMS}
          >
            {isSendingSMS ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Sending SMS...
              </>
            ) : (
              <>
                <MessageSquare className="mr-2 h-5 w-5" />
                Send SMS Alert
              </>
            )}
          </Button>
          <Button
            onClick={activateSpeakerSystem}
            variant="outline"
            className="w-full h-12 justify-start bg-transparent text-base touch-manipulation"
            disabled={!canUseQuickActions || isSendingSpeaker}
          >
            {isSendingSpeaker ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Activating Speakers...
              </>
            ) : (
              <>
                <Radio className="mr-2 h-5 w-5" />
                Activate Speaker System
              </>
            )}
          </Button>
          <Button
            onClick={postToSocialMedia}
            variant="outline"
            className="w-full h-12 justify-start bg-transparent text-base touch-manipulation"
            disabled={!canUseQuickActions || isSendingSocial}
          >
            {isSendingSocial ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Share2 className="mr-2 h-5 w-5" />
                Post to Social Media
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current Alert Level</p>
              <p className="text-2xl font-bold capitalize">{currentStatus}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Active Sensors</p>
              <p className="text-2xl font-bold">3/3</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Last Broadcast</p>
              <p className="text-2xl font-bold">{lastBroadcast || "--:--"}</p>
            </div>
          </div>

          {broadcastHistory.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Recent Broadcasts</p>
              <div className="space-y-2">
                {broadcastHistory.map((broadcast, index) => (
                  <div key={index} className="flex items-start gap-3 text-sm border-l-2 border-primary pl-3 py-1">
                    <div className="flex-1">
                      <p className="font-medium">{broadcast.time}</p>
                      <p className="text-muted-foreground line-clamp-1">{broadcast.message}</p>
                      <p className="text-xs text-muted-foreground">via {broadcast.channels}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
