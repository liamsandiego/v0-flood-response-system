/**
 * app/api/sync-status/route.ts — Cloud sync status
 *
 * GET /api/sync-status
 * → { unsynced_count: N, last_sync: {...} | null, cloud_enabled: bool }
 *
 * Used by the dashboard sync banner.
 * 
 * NOTE: This route uses SQLite and only works in LOCAL_MODE (self-hosted).
 * On Vercel/serverless, returns a graceful response indicating cloud mode.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Check if we're in a serverless environment (Vercel)
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function GET() {
  const cloudEnabled =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    process.env.NEXT_PUBLIC_LOCAL_MODE !== "true";

  // On serverless platforms, SQLite isn't available
  // Return cloud-mode response without local sync stats
  if (isServerless()) {
    return NextResponse.json({
      unsynced_count: 0,
      last_sync: null,
      cloud_enabled: cloudEnabled,
      local_mode: false,
      serverless: true,
      message: "Running on Vercel - using Supabase as primary database (no local sync)",
    });
  }

  try {
    // Dynamic import to avoid bundling issues
    const { getDb } = await import("@/lib/db");
    const db = getDb();

    const unsyncedRow = db
      .prepare("SELECT COUNT(*) as n FROM readings_local WHERE synced=0")
      .get() as { n: number };

    const lastSync = db
      .prepare(
        "SELECT * FROM sync_log ORDER BY id DESC LIMIT 1"
      )
      .get() as Record<string, unknown> | undefined;

    return NextResponse.json({
      unsynced_count: unsyncedRow.n,
      last_sync: lastSync ?? null,
      cloud_enabled: cloudEnabled,
      local_mode: process.env.NEXT_PUBLIC_LOCAL_MODE === "true",
      serverless: false,
    });
  } catch (error) {
    console.error("[/api/sync-status] error:", error);
    // Return graceful fallback on error
    return NextResponse.json({
      unsynced_count: 0,
      last_sync: null,
      cloud_enabled: cloudEnabled,
      local_mode: false,
      serverless: true,
      error: "SQLite unavailable",
    });
  }
}
