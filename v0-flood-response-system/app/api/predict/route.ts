// =============================================================================
// RapidRelay – Flood Prediction API Route (Vercel Serverless)
//
// Runs the XGBoost model (ONNX format) on Vercel without Python.
// Replaces the FastAPI /api/predictions endpoint for deployment.
//
// POST /api/predict
// Body: { features: { max_water_level_6h: number, ... } }
// Returns: { flood_probability, alert_level, method, timestamp }
//
// The ONNX model file must be at: public/models/flood_xgb_model.onnx
// Run export_onnx.py first to generate it.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

// Feature columns must match FEATURE_COLUMNS in prediction_service.py
const FEATURE_COLUMNS = [
  "max_water_level_6h",
  "max_water_level_24h",
  "water_level_slope_3h",
  "water_level_slope_6h",
  "water_level_std_24h",
  "rainfall_sum_1h",
  "rainfall_sum_6h",
  "rainfall_sum_24h",
  "rainfall_max_intensity",
  "humidity_mean_24h",
  "humidity_trend_6h",
  "soil_saturation",
  "soil_saturation_mean_24h",
];

const ALERT_THRESHOLDS = {
  DANGER: 0.8,
  WARNING: 0.6,
  WATCH: 0.4,
};

function classifyAlert(prob: number): string {
  if (prob >= ALERT_THRESHOLDS.DANGER) return "DANGER";
  if (prob >= ALERT_THRESHOLDS.WARNING) return "WARNING";
  if (prob >= ALERT_THRESHOLDS.WATCH) return "WATCH";
  return "CLEAR";
}

// Rule-based fallback when ONNX model isn't available
function ruleBased(features: Record<string, number>) {
  const waterScore = Math.min(Math.max((features.max_water_level_6h ?? 0) / 3.0, 0), 1);
  const rainScore = Math.min(Math.max((features.rainfall_sum_6h ?? 0) / 50.0, 0), 1);
  const humScore = Math.min(Math.max((features.humidity_mean_24h ?? 50) / 100.0, 0), 1);
  const soilScore = Math.min(Math.max((features.soil_saturation ?? 0.5), 0), 1);

  const risk = 0.3 * waterScore + 0.3 * rainScore + 0.2 * humScore + 0.2 * soilScore;

  return {
    flood_probability: Math.round(risk * 10000) / 10000,
    alert_level: classifyAlert(risk),
    method: "rule_based" as const,
    features_used: features,
    timestamp: new Date().toISOString(),
  };
}

let onnxSession: any = null;
let onnxLoadAttempted = false;

async function getOnnxSession() {
  if (onnxSession) return onnxSession;
  if (onnxLoadAttempted) return null;
  onnxLoadAttempted = true;

  try {
    // Dynamic import — onnxruntime-node is optional
    const ort = await import("onnxruntime-node");
    const modelPath = join(process.cwd(), "public", "models", "flood_xgb_model.onnx");
    const modelBuffer = await readFile(modelPath);
    onnxSession = await ort.InferenceSession.create(modelBuffer.buffer);
    console.log("[Predict API] ONNX model loaded successfully");
    return onnxSession;
  } catch (e) {
    console.warn("[Predict API] ONNX model not available, using rule-based fallback:", e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const features: Record<string, number> = body.features ?? {};

    // Try ONNX model first
    const session = await getOnnxSession();

    if (session) {
      const ort = await import("onnxruntime-node");
      const inputArray = new Float32Array(
        FEATURE_COLUMNS.map((col) => features[col] ?? 0.0)
      );
      const tensor = new ort.Tensor("float32", inputArray, [1, FEATURE_COLUMNS.length]);
      const results = await session.run({ features: tensor });

      // XGBoost ONNX outputs: label (int64) and probabilities (float32 map)
      const probabilities = results.probabilities?.data;
      const floodProb = probabilities ? Number(probabilities[1]) : 0;

      return NextResponse.json({
        flood_probability: Math.round(floodProb * 10000) / 10000,
        alert_level: classifyAlert(floodProb),
        method: "xgboost",
        features_used: features,
        timestamp: new Date().toISOString(),
      });
    }

    // Fallback to rule-based
    return NextResponse.json(ruleBased(features));
  } catch (error) {
    console.error("[Predict API] Error:", error);
    return NextResponse.json(
      { error: "Prediction failed", method: "error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const session = await getOnnxSession();
  return NextResponse.json({
    status: "ok",
    model_loaded: !!session,
    method: session ? "xgboost (ONNX)" : "rule_based (fallback)",
    features: FEATURE_COLUMNS,
  });
}
