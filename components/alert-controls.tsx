"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { MessageSquare, Radio, Share2, Send } from "lucide-react"
import type { AlertLevel } from "@/lib/types"
import type { UserRole } from "@/components/auth-provider"

interface AlertControlsProps {
  currentStatus: AlertLevel
  userRole: UserRole
}

export function AlertControls({ currentStatus, userRole }: AlertControlsProps) {
  const [message, setMessage] = useState("")
  const { toast } = useToast()

  const sendAlert = (channel: string) => {
    toast({
      title: `Alert Sent via ${channel}`,
      description: `Message broadcast to all residents through ${channel}`,
    })
  }

  const broadcastAll = () => {
    if (!message.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message to broadcast",
        variant: "destructive",
      })
      return
    }

    toast({
      title: "Alert Broadcast",
      description: "Message sent via SMS, Speaker, and Social Media",
    })
    setMessage("")
  }

  const canUseQuickActions = userRole === "admin"

  return (
    <div className="grid gap-4 md:grid-cols-2">
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
            />
          </div>
          <div className="grid gap-2">
            <Button onClick={broadcastAll} className="w-full">
              <Send className="mr-2 h-4 w-4" />
              Broadcast to All Channels
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
            onClick={() => sendAlert("SMS")}
            variant="outline"
            className="w-full justify-start"
            disabled={!canUseQuickActions}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Send SMS Alert
          </Button>
          <Button
            onClick={() => sendAlert("Speaker System")}
            variant="outline"
            className="w-full justify-start"
            disabled={!canUseQuickActions}
          >
            <Radio className="mr-2 h-4 w-4" />
            Activate Speaker System
          </Button>
          <Button
            onClick={() => sendAlert("Social Media")}
            variant="outline"
            className="w-full justify-start"
            disabled={!canUseQuickActions}
          >
            <Share2 className="mr-2 h-4 w-4" />
            Post to Social Media
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
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
              <p className="text-2xl font-bold">--:--</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
