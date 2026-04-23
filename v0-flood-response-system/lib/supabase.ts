/**
 * lib/supabase.ts — Supabase client
 *
 * Simple, direct Supabase client initialization.
 * Uses NEXT_PUBLIC_ env vars which are available at build time and runtime.
 *
 * NOTE: No "use client" directive here — this module is a plain utility that
 * is imported safely from both client components and server contexts.
 * The createClient() calls run entirely in the browser when imported from a
 * client component (auth-provider, useSupabaseRealtime, etc.).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Support all three naming conventions that Supabase / Vercel may use:
//   NEXT_PUBLIC_SUPABASE_ANON_KEY            — standard / .env.local
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY     — new Supabase dashboard key name
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY — older generated name
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

// Debug logging for troubleshooting
if (typeof window !== "undefined") {
  console.log("[Supabase] URL:", supabaseUrl ? `${supabaseUrl.substring(0, 40)}...` : "(not set)");
  console.log("[Supabase] Key:", supabaseAnonKey ? `${supabaseAnonKey.substring(0, 15)}...` : "(not set)");
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[Supabase] Missing environment variables!");
  console.error("Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set");
}

const projectRef = (() => {
  try {
    if (!supabaseUrl) return "unknown"
    const host = new URL(supabaseUrl).hostname
    return host.split(".")[0] || "unknown"
  } catch {
    return "unknown"
  }
})();

// Create the client - will throw clear errors if env vars are missing
export const supabase: SupabaseClient = createClient(
  supabaseUrl || "",
  supabaseAnonKey || "",
  {
    // Avoid client-side session persistence for public/anon usage to reduce
    // intermittent auth/session state bugs across refreshes.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

// Auth/session client used by login/reset flows.
// Keep this separate from read-only/public clients so dashboards can remain
// stateless while auth persists across refreshes.
export const supabaseAuth: SupabaseClient = createClient(
  supabaseUrl || "",
  supabaseAnonKey || "",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: `sb-${projectRef}-auth-session`,
    },
  }
);

// Read-only client for dashboard fetch/realtime to avoid auth-lock contention.
export const supabasePublic: SupabaseClient = createClient(
  supabaseUrl || "",
  supabaseAnonKey || "",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `sb-${projectRef}-public-readonly`,
    },
  }
);
