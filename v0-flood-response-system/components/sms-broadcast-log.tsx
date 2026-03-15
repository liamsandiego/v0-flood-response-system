"use client"

import { useEffect, useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
    Smartphone, Send, CheckCircle2, AlertTriangle, Users,
    Megaphone, Volume2, Share2, FileText,
} from "lucide-react"
import type { AlertRecord } from "@/lib/types"

interface SmsBroadcastLogProps {
    alerts: AlertRecord[]
}

interface SmsLogEntry {
    id: string
    timestamp: Date
    message: string
    recipients: number
    status: "sent" | "failed" | "queuing"
    alertLevel: "critical" | "warning" | "normal"
}

// Pre-defined alert templates for Obando Station deployment
const ALERT_TEMPLATES = [
    {
        label: "Flood Warning",
        level: "warning" as const,
        message: "[LDRRMC ALERT] FLOOD WARNING: Water levels rising at Obando dike station. Monitor PAGASA bulletins. Prepare emergency kits and know your evacuation route. Stay safe.",
    },
    {
        label: "Evacuation Alert",
        level: "critical" as const,
        message: "[LDRRMC ALERT] MANDATORY EVACUATION: Critical water levels detected at Obando flood gate. Proceed immediately to nearest evacuation center. Follow MDRRMO instructions.",
    },
    {
        label: "All Clear",
        level: "normal" as const,
        message: "[LDRRMC ALERT] ALL CLEAR: Water levels have returned to normal at Obando dike station. It is now safe to return. Continue to monitor PAGASA advisories.",
    },
]

const RECIPIENT_COUNT = {
    critical: 1245,
    warning: 45,
}

export function SmsBroadcastLog({ alerts }: SmsBroadcastLogProps) {
    const [logs, setLogs] = useState<SmsLogEntry[]>([])
    const [manualMessage, setManualMessage] = useState("")
    const processedAlerts = useRef<Set<string>>(new Set())

    // Add a log entry (used by both auto and manual broadcasts)
    const addBroadcast = (message: string, level: "critical" | "warning" | "normal", recipients?: number) => {
        const count = recipients ?? (level === "critical" ? RECIPIENT_COUNT.critical : level === "warning" ? RECIPIENT_COUNT.warning : RECIPIENT_COUNT.critical)
        const entry: SmsLogEntry = {
            id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date(),
            message,
            recipients: count,
            status: "queuing",
            alertLevel: level,
        }
        setLogs((prev) => [entry, ...prev].slice(0, 50))
        setTimeout(() => {
            setLogs((currentLogs) =>
                currentLogs.map(log =>
                    log.id === entry.id ? { ...log, status: "sent" } : log
                )
            )
        }, 2500)
    }

    useEffect(() => {
        alerts.forEach((alert) => {
            if (!processedAlerts.current.has(alert.id)) {
                if (alert.level === "normal") return
                addBroadcast(
                    `[LDRRMC ALERT] ${alert.title}: ${alert.message}. Stay safe.`,
                    alert.level,
                )
                processedAlerts.current.add(alert.id)
            }
        })
    }, [alerts])

    const handleTemplateClick = (tpl: typeof ALERT_TEMPLATES[number]) => {
        addBroadcast(tpl.message, tpl.level)
    }

    const handleManualBroadcast = () => {
        if (!manualMessage.trim()) return
        addBroadcast(manualMessage.trim(), "warning", RECIPIENT_COUNT.critical)
        setManualMessage("")
    }

    return (
        <div className="space-y-4">
            {/* ── SMS Broadcast Log ── */}
            <Card className="flex flex-col">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2">
                                <Smartphone className="h-5 w-5 text-blue-500" />
                                SMS Broadcast Log
                            </CardTitle>
                            <CardDescription>
                                Automated dissemination to LGU officials and residents
                            </CardDescription>
                        </div>
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800">
                            GATEWAY ONLINE
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 mb-4">
                        <div className="flex-1 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                            <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                                {logs.reduce((acc, log) => acc + (log.status === "sent" ? log.recipients : 0), 0).toLocaleString()}
                            </div>
                            <div className="text-xs text-muted-foreground uppercase font-semibold">Total SMS Sent</div>
                        </div>
                        <div className="flex-1 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                            <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">100%</div>
                            <div className="text-xs text-muted-foreground uppercase font-semibold">Delivery Rate</div>
                        </div>
                    </div>

                    <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-4">
                            {logs.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground">
                                    <Send className="h-10 w-10 mx-auto mb-2 opacity-20" />
                                    <p>No broadcasts sent yet.</p>
                                    <p className="text-xs">Alerts will automatically trigger SMS dissemination.</p>
                                </div>
                            ) : (
                                logs.map((log) => (
                                    <div key={log.id} className="relative pl-6 pb-2 border-l-2 border-slate-200 dark:border-slate-800 last:border-0">
                                        <div className={`absolute top-0 left-[-5px] h-2.5 w-2.5 rounded-full ${
                                            log.alertLevel === "critical" ? "bg-red-500" : log.alertLevel === "warning" ? "bg-yellow-500" : "bg-emerald-500"
                                        }`} />
                                        <div className="flex flex-col gap-1 bg-card border rounded-lg p-3 shadow-sm">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-mono text-muted-foreground">
                                                    {log.timestamp.toLocaleTimeString()}
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    {log.status === "sent" ? (
                                                        <Badge variant="secondary" className="h-5 text-[10px] gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100">
                                                            <CheckCircle2 className="h-3 w-3" /> SENT
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="h-5 text-[10px] gap-1 animate-pulse">
                                                            ... QUEUING
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-sm font-medium leading-tight">{log.message}</p>
                                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                <Users className="h-3 w-3" />
                                                <span>Target: {log.recipients.toLocaleString()} recipients</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* ── Quick Alert Templates ── */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <FileText className="h-5 w-5 text-purple-500" />
                        Quick Alert Templates
                    </CardTitle>
                    <CardDescription>Pre-defined messages for Obando Station deployment</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {ALERT_TEMPLATES.map((tpl) => (
                            <Button
                                key={tpl.label}
                                variant="outline"
                                size="sm"
                                className={`gap-1.5 ${
                                    tpl.level === "critical" ? "border-red-500/30 text-red-400 hover:bg-red-500/10" :
                                    tpl.level === "warning" ? "border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10" :
                                    "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                }`}
                                onClick={() => handleTemplateClick(tpl)}
                            >
                                {tpl.level === "critical" ? <AlertTriangle className="h-3.5 w-3.5" /> :
                                 tpl.level === "warning" ? <AlertTriangle className="h-3.5 w-3.5" /> :
                                 <CheckCircle2 className="h-3.5 w-3.5" />}
                                {tpl.label}
                            </Button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* ── Manual Broadcast Composer ── */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Megaphone className="h-5 w-5 text-orange-500" />
                        Broadcast Alert
                    </CardTitle>
                    <CardDescription>Manual composer — send custom alerts to all channels</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <textarea
                        value={manualMessage}
                        onChange={(e) => setManualMessage(e.target.value)}
                        placeholder="Type your alert message..."
                        rows={3}
                        className="w-full bg-slate-50 dark:bg-slate-900 border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                    />
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            onClick={handleManualBroadcast}
                            disabled={!manualMessage.trim()}
                            className="flex-1 gap-2 bg-cyan-600 hover:bg-cyan-700 text-white"
                        >
                            <Megaphone className="h-4 w-4" />
                            Broadcast to All Channels
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => manualMessage.trim() && addBroadcast(manualMessage.trim(), "warning", RECIPIENT_COUNT.critical)}>
                            <Send className="h-3 w-3" /> Send SMS
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => {}}>
                            <Volume2 className="h-3 w-3" /> Activate Speaker
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => {}}>
                            <Share2 className="h-3 w-3" /> Social Media
                        </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
                        <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-yellow-500" /> System Status: warning
                        </span>
                        <span className="mx-1">|</span>
                        <span>3/3 Active</span>
                        <span className="mx-1">|</span>
                        <span>Last: {logs[0]?.timestamp.toLocaleTimeString() ?? "--:--"}</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
