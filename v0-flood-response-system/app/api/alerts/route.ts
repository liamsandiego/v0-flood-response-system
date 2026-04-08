/**
 * app/api/alerts/route.ts — SQLite-backed alerts endpoint
 *
 * GET  /api/alerts         → recent alerts from readings_local (requires_human=1 or alert_level != NORMAL)
 * POST /api/alerts/ack     → acknowledge a reading (set requires_human=0)
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 500);
    const unacknowledged = url.searchParams.get("unack") === "1";

    let query = `
      SELECT id, sensor_id, validated_m, alert_level, uncertainty,
             requires_human, explanation, constraint_note, created_at
      FROM readings_local
      WHERE alert_level != 'NORMAL' OR requires_human = 1
    `;
    if (unacknowledged) {
      query += ` AND requires_human = 1`;
    }
    query += ` ORDER BY created_at DESC LIMIT ?`;

    const rows = db.prepare(query).all(limit) as Record<string, unknown>[];

    const alerts = rows.map((r) => ({
      ...r,
      requires_human: Boolean(r.requires_human),
      explanation: r.explanation
        ? (() => { try { return JSON.parse(r.explanation as string); } catch { return null; } })()
        : null,
      // Map to alert format expected by the existing alert components
      level:
        r.alert_level === "EMERGENCY" ? "critical" :
        r.alert_level === "WARNING" ? "warning" : "info",
      title: `${r.alert_level} — Sensor ${r.sensor_id}`,
      message: `Water level: ${r.validated_m ? Number(r.validated_m).toFixed(2) : "N/A"}m | ${r.constraint_note ?? "Ensemble flagged"}`,
    }));

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    console.error("[/api/alerts] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts", detail: String(error) },
      { status: 500 }
    );
  }
}

// Acknowledge a reading (clear requires_human flag)
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    db.prepare("UPDATE readings_local SET requires_human = 0 WHERE id = ?").run(id);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to acknowledge", detail: String(error) },
      { status: 500 }
    );
  }
}
