/**
 * lib/supabase-server.ts — Server-side Supabase client
 *
 * For use in API routes and server components.
 * Does NOT include "use client" directive.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let serverClient: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient | null {
  if (!url || !key) {
    console.warn("[Supabase Server] Missing credentials");
    return null;
  }

  if (!serverClient) {
    serverClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return serverClient;
}
