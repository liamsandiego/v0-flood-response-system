/**
 * app/api/readings/route.ts — SQLite readings endpoint
 *
 * GET  /api/readings         → last N readings from readings_local
 * POST /api/readings/ingest  → insert a new reading (called by lora_bridge.py)
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb, type LocalReading } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET — fetch recent readings
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 1000);
    const sensor = url.searchParams.get("sensor");

    let rows: LocalReading[];
    if (sensor) {
      rows = db
        .prepare(
          `SELECT * FROM readings_local WHERE sensor_id = ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(sensor, limit) as LocalReading[];
    } else {
      rows = db
        .prepare(
          `SELECT * FROM readings_local
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as LocalReading[];
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
      { error: "Failed to fetch readings", detail: String(error) },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — ingest a reading (from lora_bridge.py or simulator)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
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
