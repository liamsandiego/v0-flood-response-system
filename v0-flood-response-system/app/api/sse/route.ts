/**
 * app/api/sse/route.ts — Server-Sent Events (replaces Supabase Realtime)
 *
 * Streams the latest SQLite reading every 5 seconds to all connected clients.
 * Compatible with EventSource browser API.
 *
 * NOTE: This route requires SQLite and only works in LOCAL_MODE (self-hosted).
 * On Vercel/serverless deployments, this will return an error response.
 *
 * Event format:
 *   data: {"type":"sensor_update","reading":{...},"count":N}\n\n
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // required for better-sqlite3

const POLL_INTERVAL_MS = 5000;

// Check if we're in a serverless environment (Vercel)
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function GET() {
  // On serverless platforms, SQLite isn't available - return graceful error
  if (isServerless()) {
    return NextResponse.json(
      {
        error: "SSE not available",
        message: "Server-Sent Events require LOCAL_MODE with SQLite. Use Supabase Realtime for cloud deployments.",
        hint: "This is expected behavior on Vercel. The frontend should use Supabase Realtime instead.",
      },
      { status: 501 }
    );
  }

  // Dynamic import to avoid bundling issues on Vercel
  let db: ReturnType<typeof import("@/lib/db").getDb>;
  try {
    const { getDb } = await import("@/lib/db");
    db = getDb();
  } catch (err) {
    console.error("[SSE] Failed to load SQLite:", err);
    return NextResponse.json(
      { error: "SQLite unavailable", message: String(err) },
      { status: 500 }
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let interval: ReturnType<typeof setInterval>;

      function encode(data: string) {
        return new TextEncoder().encode(data);
      }

      function sendEvent(payload: object) {
        if (closed) return;
        try {
          controller.enqueue(encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      }

      function poll() {
        if (closed) {
          clearInterval(interval);
          return;
        }

        try {
          // Get the latest reading
          const latest = db
            .prepare(
              `SELECT * FROM readings_local ORDER BY id DESC LIMIT 1`
            )
            .get() as Record<string, unknown> | undefined;

          // Get count of unsynced records
          const unsyncedRow = db
            .prepare(`SELECT COUNT(*) as n FROM readings_local WHERE synced=0`)
            .get() as { n: number };

          // Get active sensor count (sensors with readings in last 60s)
          const activeSensorsRow = db
            .prepare(`
              SELECT COUNT(DISTINCT sensor_id) as n
              FROM readings_local
              WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now', '-60 seconds'))
            `)
            .get() as { n: number };

          if (latest) {
            sendEvent({
              type: "sensor_update",
              reading: {
                ...latest,
                requires_human: Boolean(latest.requires_human),
                constraint_pass: Boolean(latest.constraint_pass),
                synced: Boolean(latest.synced),
                explanation: latest.explanation
                  ? (() => {
                      try {
                        return JSON.parse(latest.explanation as string);
                      } catch {
                        return null;
                      }
                    })()
                  : null,
              },
              unsynced: unsyncedRow.n,
              active_sensors: activeSensorsRow.n,
              ts: new Date().toISOString(),
            });
          } else {
            // Heartbeat even if no data yet
            sendEvent({
              type: "heartbeat",
              unsynced: unsyncedRow.n,
              active_sensors: 0,
              ts: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.error("[SSE] poll error:", err);
          if (!closed) {
            sendEvent({ type: "error", message: String(err) });
          }
        }
      }

      // Send initial event immediately
      poll();
      interval = setInterval(poll, POLL_INTERVAL_MS);

      // Cleanup
      return () => {
        closed = true;
        clearInterval(interval);
      };
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering if proxied
    },
  });
}
