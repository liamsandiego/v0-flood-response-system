/**
 * app/api/sync-status/route.ts — Cloud sync status
 *
 * GET /api/sync-status
 * → { unsynced_count: N, last_sync: {...} | null, cloud_enabled: bool }
 *
 * Used by the dashboard sync banner.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();

    const unsyncedRow = db
      .prepare("SELECT COUNT(*) as n FROM readings_local WHERE synced=0")
      .get() as { n: number };

    const lastSync = db
      .prepare(
        "SELECT * FROM sync_log ORDER BY id DESC LIMIT 1"
      )
      .get() as Record<string, unknown> | undefined;

    const cloudEnabled =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.NEXT_PUBLIC_LOCAL_MODE !== "true";

    return NextResponse.json({
      unsynced_count: unsyncedRow.n,
      last_sync: lastSync ?? null,
      cloud_enabled: cloudEnabled,
      local_mode: process.env.NEXT_PUBLIC_LOCAL_MODE === "true",
    });
  } catch (error) {
    console.error("[/api/sync-status] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sync status", detail: String(error) },
      { status: 500 }
    );
  }
}
