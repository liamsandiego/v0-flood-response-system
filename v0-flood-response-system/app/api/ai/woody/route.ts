/**
 * app/api/ai/woody/route.ts — Ollama local proxy ("Woody")
 *
 * POST /api/ai/woody
 *   body: { reading_m: number, context?: { tide, rain, history, sentinel_age } }
 *   → { possibilities: [str, str, str], sentinel_disagreement: bool, offline: bool }
 *
 * Advisory only — Woody EXPLAINS, never validates.
 * Returns offline:true gracefully if Ollama is not running.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const TIMEOUT_MS = 20_000;

function buildPrompt(reading_m: number, context: Record<string, unknown>): string {
  const { tide = "N/A", rain = 0, history = [], sentinel_age = "unknown" } = context;
  const historyStr =
    Array.isArray(history) && history.length > 0
      ? (history as number[]).map((v) => `${v.toFixed(2)}m`).join(" → ")
      : "unavailable";

  return `You are a hydrology assistant for Obando, Bulacan.

HARD DATA (verify before using):
- Sensor reading: ${reading_m.toFixed(3)}m
- Tide: ${tide}m
- Rain: ${rain}mm/hr
- Sentinel-1 last pass: ${sentinel_age}h ago
- History (oldest→newest): ${historyStr}

TASK: List 3 possibilities for this reading:
1. Most likely physical cause if the reading is accurate
2. Most likely sensor malfunction if the reading is inaccurate
3. Worst-case scenario if the reading is true

RULES:
- Do NOT say "valid" or "invalid"
- Do NOT give confidence percentages  
- Flag if Sentinel-1 data contradicts the sensor reading

Output JSON only:
{"possibilities": ["<cause>", "<malfunction>", "<worst_case>"], "sentinel_disagreement": false}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reading_m, context = {} } = body;

    if (reading_m === undefined || reading_m === null) {
      return NextResponse.json({ error: "reading_m required" }, { status: 400 });
    }

    const prompt = buildPrompt(Number(reading_m), context);

    // Call Ollama with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let ollamaResp: Response;
    try {
      ollamaResp = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          format: "json",
          options: { temperature: 0.3, num_predict: 256 },
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const isAbort =
        typeof err === "object" && err !== null && "name" in err && (err as {name: string}).name === "AbortError";
      console.warn("[Woody] Ollama unreachable:", isAbort ? "timeout" : err);
      return NextResponse.json({
        possibilities: [
          "Physical cause unavailable (AI offline)",
          "Sensor fault analysis unavailable (AI offline)",
          "Worst-case analysis unavailable (AI offline)",
        ],
        sentinel_disagreement: false,
        offline: true,
        model: OLLAMA_MODEL,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!ollamaResp.ok) {
      return NextResponse.json(
        { error: `Ollama error ${ollamaResp.status}`, offline: true },
        { status: 502 }
      );
    }

    const ollamaData = await ollamaResp.json();
    const responseText: string = ollamaData.response || "{}";

    let parsed: { possibilities?: unknown[]; sentinel_disagreement?: boolean };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Attempt to extract JSON block from text
      const match = responseText.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return NextResponse.json({
      possibilities: Array.isArray(parsed.possibilities)
        ? parsed.possibilities.slice(0, 3)
        : ["Analysis unavailable", "Analysis unavailable", "Analysis unavailable"],
      sentinel_disagreement: Boolean(parsed.sentinel_disagreement),
      offline: false,
      model: OLLAMA_MODEL,
    });
  } catch (error) {
    console.error("[Woody] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: String(error) },
      { status: 500 }
    );
  }
}
