"use client"

import React, { useEffect, useState } from "react"
import { getTelemetry, clearTelemetry, type TelemetryEvent } from "@/lib/realtimeTelemetry"

export default function SupabaseDebugPage() {
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([])

  useEffect(() => {
    let mounted = true
    fetch('/api/sync-status')
      .then((r) => r.json())
      .then((d) => { if (mounted) setResult(d) })
      .catch((e) => { if (mounted) setError(String(e)) })
    // Load client-side telemetry
    if (mounted) setTelemetry(getTelemetry())
    return () => { mounted = false }
  }, [])

  function refreshTelemetry() {
    setTelemetry(getTelemetry())
  }

  function clearAllTelemetry() {
    clearTelemetry()
    setTelemetry([])
  }

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h2>Supabase Debug</h2>
      <p>Calls server-side <code>/api/sync-status</code> which performs a Supabase connectivity test.</p>

      {error && (
        <div style={{ color: 'crimson' }}>
          <h3>Network / Fetch Error</h3>
          <pre>{error}</pre>
        </div>
      )}

      {!error && !result && <div>Loading…</div>}

      {result && (
        <div>
          <h3>Server Debug</h3>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#fff', padding: 12, borderRadius: 6 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <h3>Client Telemetry (local)</h3>
        <div style={{ marginBottom: 6 }}>
          <button onClick={refreshTelemetry} style={{ marginRight: 8 }}>Refresh</button>
          <button onClick={clearAllTelemetry}>Clear</button>
        </div>
        <div style={{ maxHeight: 400, overflow: 'auto', background: '#0b1220', color: '#e6eef8', padding: 12, borderRadius: 6 }}>
          {telemetry.length === 0 && <div style={{ color: '#9aa6b2' }}>No telemetry recorded</div>}
          {telemetry.map((t, i) => (
            <div key={i} style={{ borderBottom: '1px solid #122029', padding: '6px 0' }}>
              <div style={{ fontSize: 12, color: '#7fb5d8' }}>{t.ts} — <strong>{t.type}</strong></div>
              {t.message && <div style={{ fontSize: 12 }}>{t.message}</div>}
              {t.meta && <pre style={{ fontSize: 11, marginTop: 6 }}>{JSON.stringify(t.meta, null, 2)}</pre>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
