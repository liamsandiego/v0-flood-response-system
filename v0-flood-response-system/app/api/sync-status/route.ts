/**
 * app/api/sync-status/route.ts — Cloud sync status + debug info
 *
 * GET /api/sync-status
 * → { unsynced_count: N, last_sync: {...} | null, cloud_enabled: bool, debug: {...} }
 *
 * Used by the dashboard sync banner.
 * Also includes environment debug info to troubleshoot deployment issues.
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  const cloudEnabled =
    Boolean(supabaseUrl) &&
    process.env.NEXT_PUBLIC_LOCAL_MODE !== "true";

  // Debug info for troubleshooting deployments
  const debug = {
    hasSupabaseUrl: Boolean(supabaseUrl),
    supabaseUrlPreview: supabaseUrl ? `${supabaseUrl.substring(0, 35)}...` : "(not set)",
    hasSupabaseKey: Boolean(supabaseKey),
    supabaseKeyPreview: supabaseKey ? `${supabaseKey.substring(0, 15)}...` : "(not set)",
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile (default)",
    nodeEnv: process.env.NODE_ENV,
    isVercel: Boolean(process.env.VERCEL),
    timestamp: new Date().toISOString(),
  };

  // Quick Supabase test
  let supabaseTest = { connected: false, error: "", rowCount: 0 };
  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from("obando_environmental_data")
        .select("id")
        .limit(1);
      
      if (error) {
        supabaseTest = { connected: false, error: error.message, rowCount: 0 };
      } else {
        supabaseTest = { connected: true, error: "", rowCount: data?.length || 0 };
      }
    } catch (e) {
      supabaseTest = { connected: false, error: String(e), rowCount: 0 };
    }
  }

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
      debug,
      supabaseTest,
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
      debug,
      supabaseTest,
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
      debug,
      supabaseTest,
    });
  }
}
