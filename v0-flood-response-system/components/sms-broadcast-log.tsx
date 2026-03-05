"use client"

import { useEffect, useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Smartphone, Send, CheckCircle2, AlertTriangle, Users } from "lucide-react"
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

export function SmsBroadcastLog({ alerts }: SmsBroadcastLogProps) {
    const [logs, setLogs] = useState<SmsLogEntry[]>([])
    const processedAlerts = useRef<Set<string>>(new Set())

    // Mock recipient groups
    const RECIPIENT_COUNT = {
        critical: 1245, // All residents + LGU
        warning: 45,    // Barangay Captains + Responders
    }

    useEffect(() => {
        // Check for new alerts to "broadcast"
        const newLogs: SmsLogEntry[] = []

        alerts.forEach((alert) => {
            if (!processedAlerts.current.has(alert.id)) {
                // Only broadcast for warning/critical
                if (alert.level === "normal") return

                // Simulate a broadcast event
                const count = alert.level === "critical" ? RECIPIENT_COUNT.critical : RECIPIENT_COUNT.warning

                newLogs.unshift({
                    id: `sms-${alert.id}`,
                    timestamp: new Date(),
                    message: `[LDRRMC ALERT] ${alert.title}: ${alert.message}. Stay safe.`,
                    recipients: count,
                    status: "queuing",
                    alertLevel: alert.level,
                })

                processedAlerts.current.add(alert.id)
            }
        })

        if (newLogs.length > 0) {
            setLogs((prev) => [...newLogs, ...prev].slice(0, 50)) // Keep last 50

            // Simulate sending delay
            setTimeout(() => {
                setLogs((currentLogs) =>
                    currentLogs.map(log =>
                        log.status === "queuing" ? { ...log, status: "sent" } : log
                    )
                )
            }, 2500)
        }
    }, [alerts])

    return (
        <Card className="h-[600px] flex flex-col">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                            <Smartphone className="h-5 w-5 text-blue-500" />
                            SMS Broadcast Log
                        </CardTitle>
                        <CardDescription>
                            Automated dissemination to LGU officials and registered residents
                        </CardDescription>
                    </div>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        GATEWAY ONLINE
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0">
                <div className="flex gap-4 mb-4">
                    <div className="flex-1 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                        <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                            {logs.reduce((acc, log) => acc + (log.status === 'sent' ? log.recipients : 0), 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground uppercase font-semibold">Total SMS Sent</div>
                    </div>
                    <div className="flex-1 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border text-center">
                        <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">100%</div>
                        <div className="text-xs text-muted-foreground uppercase font-semibold">Delivery Rate</div>
                    </div>
                </div>

                <ScrollArea className="h-[400px] pr-4">
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
                                    <div className={`absolute top-0 left-[-5px] h-2.5 w-2.5 rounded-full ${log.alertLevel === "critical" ? "bg-red-500" : "bg-yellow-500"
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
    )
}
