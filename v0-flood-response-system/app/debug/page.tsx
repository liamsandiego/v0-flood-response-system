"use client"

import React, { useEffect, useState } from "react"

export default function SupabaseDebugPage() {
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/sync-status')
      .then((r) => r.json())
      .then((d) => { if (mounted) setResult(d) })
      .catch((e) => { if (mounted) setError(String(e)) })
    return () => { mounted = false }
  }, [])

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
    </div>
  )
}
