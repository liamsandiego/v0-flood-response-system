// =============================================================================
// RapidRelay – AI Interpretation Panel
//
// Fetches AI-powered flood risk interpretation from the backend (Groq LLM)
// and displays it in a glassmorphism card. Auto-refreshes every 60 seconds.
// =============================================================================

"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, RefreshCw, AlertTriangle } from "lucide-react";
import GlassCard from "./GlassCard";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "";
const REFRESH_INTERVAL = 30 * 60_000; // 30 minutes

interface AIResponse {
  interpretation: string;
  model: string | null;
  prediction?: {
    flood_probability: number;
    alert_level: string;
  };
  timestamp: string;
  error: boolean;
}

export default function AIInterpretationPanel() {
  const [data, setData] = useState<AIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);

  const fetchInterpretation = useCallback(async () => {
    setLoading(true);
    try {
      // Try backend first (local dev), fall back to Next.js API route (Vercel)
      let res: Response | null = null;
      if (BACKEND_URL) {
        try {
          res = await fetch(`${BACKEND_URL}/api/ai/interpret`, { signal: AbortSignal.timeout(5000) });
        } catch {
          // Backend unreachable — fall through to Next.js route
        }
      }
      if (!res || !res.ok) {
        res = await fetch("/api/ai/interpret");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AIResponse = await res.json();
      setData(json);
      setLastFetched(new Date());

      const lowerMsg = (json.interpretation || "").toLowerCase();
      const keyIssue =
        lowerMsg.includes("invalid api key") ||
        lowerMsg.includes("invalid_api_key") ||
        lowerMsg.includes("not configured") ||
        lowerMsg.includes("temporarily disabled");

      if (json.error && keyIssue) {
        setAutoRefreshPaused(true);
      }
    } catch (e) {
      setData({
        interpretation: `Failed to connect to AI service: ${e instanceof Error ? e.message : "Unknown error"}`,
        model: null,
        timestamp: new Date().toISOString(),
        error: true,
      });
      setAutoRefreshPaused(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch on mount + interval (unless paused due to key/config errors)
  useEffect(() => {
    fetchInterpretation();
    if (autoRefreshPaused) return;

    const interval = setInterval(fetchInterpretation, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchInterpretation, autoRefreshPaused]);

  return (
    <GlassCard className="flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-400" />
            <h2 className="font-mono text-[10px] text-white/50 tracking-widest uppercase">
              AI Analysis
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {data?.model && (
              <span className="font-mono text-[8px] text-white/20 bg-white/5 px-1.5 py-0.5 rounded">
                {data.model.split("/").pop()}
              </span>
            )}
            <button
              onClick={() => {
                setAutoRefreshPaused(false);
                fetchInterpretation();
              }}
              disabled={loading}
              className="text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
              title="Refresh interpretation"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 overflow-y-auto max-h-[300px] scrollbar-thin">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-white/30">
            <div className="h-3 w-3 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            <span className="font-mono text-[10px]">Analyzing flood situation...</span>
          </div>
        ) : data?.error ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] text-amber-300/80 leading-relaxed">
              {data.interpretation}
            </p>
          </div>
        ) : data ? (
          <div className="space-y-2">
            {data.interpretation.split("\n\n").map((paragraph, i) => (
              <p
                key={i}
                className="font-mono text-[10px] text-white/70 leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: paragraph
                    .replace(/\*\*(.+?)\*\*/g, "<strong class='text-white/90'>$1</strong>")
                    .replace(/\n/g, "<br />"),
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      {lastFetched && (
        <div className="px-4 pb-3 pt-1 border-t border-white/5">
          <div className="flex items-center justify-between font-mono text-[8px] text-white/20">
            <span>{autoRefreshPaused ? "Auto-refresh: paused" : "Auto-refresh: 30m"}</span>
            <span>
              {lastFetched.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
