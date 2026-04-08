// =============================================================================
// RapidRelay – AI Interpretation API Route (Vercel Serverless)
//
// Calls Groq's LLM API to generate flood risk interpretations.
// Replaces the FastAPI /api/ai/interpret endpoint for deployment.
//
// GET /api/ai/interpret
// Fetches latest sensor data from Supabase, builds context, calls Groq.
//
// Requires env var: GROQ_API_KEY (server-side only, no NEXT_PUBLIC_ prefix)
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "mixtral-8x7b-32768";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const SYSTEM_PROMPT = `You are the AI analyst for RAPID RELAY, a hyper-localized flood early warning system deployed in Obando, Bulacan, Philippines.

You receive real-time sensor data from 5 IoT nodes and ML flood predictions (XGBoost model trained on 9 years of environmental data). Your job is to provide a concise, actionable flood risk interpretation for emergency responders and barangay officials.

Guidelines:
- Be direct and concise. Use 2-4 short paragraphs max.
- Start with the current alert level and flood probability in bold.
- Explain what the sensor readings mean in plain language.
- If flood risk is elevated, explain WHY (which sensors are concerning).
- Include specific recommended actions based on alert level:
  - CLEAR: Routine monitoring, no action needed.
  - WATCH: Increased monitoring frequency, prepare evacuation routes.
  - WARNING: Alert barangay officials, pre-position rescue equipment, warn residents near waterways.
  - DANGER: Immediate evacuation of flood-prone barangays, activate emergency response.
- Reference specific sensor locations by name when relevant.
- Keep timestamps in Philippine Time (PHT, UTC+8).
- Do NOT use markdown headers. Use bold (**text**) sparingly for emphasis.`;

function classifyAlert(prob: number): string {
  if (prob >= 0.8) return "DANGER";
  if (prob >= 0.6) return "WARNING";
  if (prob >= 0.4) return "WATCH";
  return "CLEAR";
}

export async function GET() {
  if (!GROQ_API_KEY) {
    return NextResponse.json({
      interpretation: "AI interpretation unavailable — GROQ_API_KEY not configured.",
      model: null,
      error: true,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // Fetch latest sensor readings from Supabase
    let sensorSummary: Record<string, unknown>[] = [];
    let prediction = { flood_probability: 0, alert_level: "CLEAR", method: "no_data" };

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      // Get last batch of sensor readings (5 nodes)
      const { data: readings } = await supabase
        .from("sensor_readings")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(5);

      if (readings && readings.length > 0) {
        sensorSummary = readings.map((r) => ({
          sensor_id: r.sensor_id,
          water_level_m: r.water_level,
          rainfall_mm_h: r.rainfall,
          humidity_pct: r.humidity,
          soil_moisture_pct: r.soil_moisture,
          temperature_c: r.temperature,
          is_valid: r.is_valid,
        }));

        // Compute simple risk from latest readings
        const avgWater = readings.reduce((s: number, r: any) => s + (r.water_level ?? 0), 0) / readings.length;
        const avgRain = readings.reduce((s: number, r: any) => s + (r.rainfall ?? 0), 0) / readings.length;
        const avgHumid = readings.reduce((s: number, r: any) => s + (r.humidity ?? 50), 0) / readings.length;

        const waterScore = Math.min(Math.max(avgWater / 3.0, 0), 1);
        const rainScore = Math.min(Math.max(avgRain / 50.0, 0), 1);
        const humScore = Math.min(Math.max(avgHumid / 100.0, 0), 1);
        const risk = 0.4 * rainScore + 0.3 * humScore + 0.3 * waterScore;

        prediction = {
          flood_probability: Math.round(risk * 10000) / 10000,
          alert_level: classifyAlert(risk),
          method: "rule_based",
        };
      }

      // Check for latest ML prediction
      const { data: preds } = await supabase
        .from("flood_predictions")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1);

      if (preds && preds.length > 0) {
        prediction = {
          flood_probability: preds[0].flood_probability,
          alert_level: classifyAlert(preds[0].flood_probability),
          method: preds[0].method || "xgboost",
        };
      }
    }

    const now = new Date().toISOString();
    const userMessage = `Current situation as of ${now}:

**ML Prediction:**
- Flood probability: ${(prediction.flood_probability * 100).toFixed(1)}%
- Alert level: ${prediction.alert_level}
- Method: ${prediction.method}

**Live Sensor Readings (5 IoT nodes in Obando, Bulacan):**
${JSON.stringify(sensorSummary, null, 2)}

Provide your flood risk interpretation and recommended actions.`;

    // Call Groq API with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_completion_tokens: 1024,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const text = result.choices?.[0]?.message?.content || "";

    return NextResponse.json({
      interpretation: text.trim(),
      model: GROQ_MODEL,
      prediction,
      timestamp: now,
      error: false,
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    const isTimeout = errorMsg.includes("abort") || errorMsg.includes("timeout");

    return NextResponse.json({
      interpretation: `AI interpretation failed: ${isTimeout ? "Groq API timeout (10s)" : errorMsg}`,
      model: GROQ_MODEL,
      timestamp: new Date().toISOString(),
      error: true,
    });
  }
}
