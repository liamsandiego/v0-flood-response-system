/**
 * lib/supabase.ts — Supabase client
 *
 * Simple, direct Supabase client initialization.
 * Uses NEXT_PUBLIC_ env vars which are available at build time and runtime.
 */

"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Debug logging for troubleshooting
if (typeof window !== "undefined") {
  console.log("[Supabase] URL:", supabaseUrl ? `${supabaseUrl.substring(0, 40)}...` : "(not set)");
  console.log("[Supabase] Key:", supabaseAnonKey ? `${supabaseAnonKey.substring(0, 15)}...` : "(not set)");
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[Supabase] Missing environment variables!");
  console.error("Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set");
}

// Create the client - will throw clear errors if env vars are missing
export const supabase: SupabaseClient = createClient(
  supabaseUrl || "",
  supabaseAnonKey || "",
  {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);
