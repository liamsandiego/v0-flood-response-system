/**
 * app/api/alerts/route.ts — SQLite-backed alerts endpoint
 *
 * GET  /api/alerts         → recent alerts from readings_local (requires_human=1 or alert_level != NORMAL)
 * POST /api/alerts/ack     → acknowledge a reading (set requires_human=0)
 * 
 * NOTE: This route uses SQLite and only works in LOCAL_MODE (self-hosted).
 * On Vercel/serverless, returns empty alerts (use Supabase for cloud alerts).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Check if we're in a serverless environment (Vercel)
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function GET(request: NextRequest) {
  // On serverless, return empty alerts (frontend uses Supabase directly)
  if (isServerless()) {
    return NextResponse.json({
      alerts: [],
      count: 0,
      message: "Local alerts not available on Vercel. Use Supabase alert tables.",
    });
  }

  try {
    const { getDb } = await import("@/lib/db");
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
      { error: "Failed to fetch alerts", detail: String(error), alerts: [], count: 0 },
      { status: 500 }
    );
  }
}

// Acknowledge a reading (clear requires_human flag)
export async function PATCH(request: NextRequest) {
  // On serverless, acknowledgment not supported
  if (isServerless()) {
    return NextResponse.json({
      error: "Local alert acknowledgment not available on Vercel",
      message: "Use Supabase to manage alerts in cloud deployments",
    }, { status: 501 });
  }

  try {
    const { getDb } = await import("@/lib/db");
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
