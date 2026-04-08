/**
 * app/api/readings/route.ts — SQLite readings endpoint
 *
 * GET  /api/readings         → last N readings from readings_local
 * POST /api/readings/ingest  → insert a new reading (called by lora_bridge.py)
 * 
 * NOTE: This route uses SQLite and only works in LOCAL_MODE (self-hosted).
 * On Vercel/serverless, returns a graceful error directing to Supabase.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Check if we're in a serverless environment (Vercel)
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

// ---------------------------------------------------------------------------
// GET — fetch recent readings
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  // On serverless, direct clients to use Supabase
  if (isServerless()) {
    return NextResponse.json({
      error: "SQLite not available on Vercel",
      message: "Use Supabase directly for sensor readings in cloud deployments",
      readings: [],
      count: 0,
    }, { status: 501 });
  }

  try {
    const { getDb, type LocalReading } = await import("@/lib/db") as typeof import("@/lib/db");
    const db = getDb();
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 1000);
    const sensor = url.searchParams.get("sensor");

    type LocalReadingType = typeof LocalReading extends never ? {
      id: number;
      sensor_id: string;
      raw_mm: number | null;
      validated_m: number | null;
      uncertainty: number | null;
      alert_level: string;
      requires_human: number;
      explanation: string | null;
      constraint_pass: number;
      constraint_note: string | null;
      synced: number;
      cloud_id: string | null;
      created_at: string;
    } : LocalReading;

    let rows: LocalReadingType[];
    if (sensor) {
      rows = db
        .prepare(
          `SELECT * FROM readings_local WHERE sensor_id = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(sensor, limit) as LocalReadingType[];
    } else {
      rows = db
        .prepare(
          `SELECT * FROM readings_local
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as LocalReadingType[];
    }

    // Parse explanation JSON field
    const readings = rows.map((r) => ({
      ...r,
      requires_human: Boolean(r.requires_human),
      constraint_pass: Boolean(r.constraint_pass),
      synced: Boolean(r.synced),
      explanation: r.explanation ? JSON.parse(r.explanation) : null,
    }));

    return NextResponse.json({ readings, count: readings.length });
  } catch (error) {
    console.error("[/api/readings] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch readings", detail: String(error), readings: [], count: 0 },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — ingest a reading (from lora_bridge.py or simulator)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // On serverless, local ingest is not supported
  if (isServerless()) {
    return NextResponse.json({
      error: "Local ingest not available on Vercel",
      message: "Use the Python sync_engine to push data to Supabase",
    }, { status: 501 });
  }

  try {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const body = await request.json();

    const {
      sensor_id,
      raw_mm = null,
      validated_m = null,
      uncertainty = null,
      alert_level = "NORMAL",
      requires_human = false,
      explanation = null,
      constraint_pass = true,
      constraint_note = null,
    } = body;

    if (!sensor_id) {
      return NextResponse.json({ error: "sensor_id required" }, { status: 400 });
    }

    const stmt = db.prepare(`
      INSERT INTO readings_local
        (sensor_id, raw_mm, validated_m, uncertainty, alert_level,
         requires_human, explanation, constraint_pass, constraint_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      sensor_id,
      raw_mm,
      validated_m,
      uncertainty,
      alert_level,
      requires_human ? 1 : 0,
      explanation ? JSON.stringify(explanation) : null,
      constraint_pass ? 1 : 0,
      constraint_note
    );

    return NextResponse.json(
      { id: result.lastInsertRowid, sensor_id, alert_level },
      { status: 201 }
    );
  } catch (error) {
    console.error("[/api/readings] POST error:", error);
    return NextResponse.json(
      { error: "Failed to insert reading", detail: String(error) },
      { status: 500 }
    );
  }
}
