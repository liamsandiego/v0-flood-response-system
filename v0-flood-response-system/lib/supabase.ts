/**
 * lib/supabase.ts — Supabase client
 *
 * Returns a real Supabase client using env credentials.
 * Auth is always required — no LOCAL_MODE bypass.
 * 
 * IMPORTANT: Environment variables must be available at runtime.
 * On Vercel, ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * are set in the project settings (not just .env.local).
 */

"use client";

// Lazy-load the client to ensure env vars are available at runtime
let _supabaseClient: any = null;
let _initAttempted = false;

function getEnvVars() {
  // These are read at runtime, not build time
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

// Build a minimal no-op stub when credentials are missing (so the app doesn't crash on import)
function createNoOpClient() {
  const noOpClient: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "subscribe") return () => ({ unsubscribe: () => {} });
        if (prop === "unsubscribe") return () => {};
        if (prop === "channel") return () => noOpClient;
        if (prop === "on") return () => noOpClient;
        if (prop === "removeChannel") return () => {};
        if (prop === "from") return () => ({
          select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: new Error("No Supabase client - check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY") }) }) }),
        });
        return () => noOpClient;
      },
    }
  );
  return noOpClient;
}

function initClient() {
  if (_initAttempted) return _supabaseClient;
  _initAttempted = true;

  const { url, key } = getEnvVars();

  if (!url || !key || url === "" || key === "") {
    console.warn("[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    console.warn("[Supabase] URL:", url ? `${url.substring(0, 30)}...` : "(not set)");
    console.warn("[Supabase] Key:", key ? `${key.substring(0, 10)}...` : "(not set)");
    _supabaseClient = createNoOpClient();
    return _supabaseClient;
  }

  // Validate key format - should be a JWT starting with 'eyJ'
  if (!key.startsWith("eyJ")) {
    console.error(`[Supabase] Invalid anon key format! Key should start with 'eyJ' (JWT format).`);
    console.error(`[Supabase] Your key starts with: "${key.substring(0, 20)}..."`);
    console.error(`[Supabase] Get the correct key from: Supabase Dashboard → Project Settings → API → anon key`);
    _supabaseClient = createNoOpClient();
    return _supabaseClient;
  }

  console.log(`[Supabase] Connecting to ${url.substring(0, 40)}...`);

  try {
    const { createClient } = require("@supabase/supabase-js");
    _supabaseClient = createClient(url, key, {
      auth: {
        lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
    console.log("[Supabase] Client initialized successfully");
  } catch (err) {
    console.error("[Supabase] Failed to create client:", err);
    _supabaseClient = createNoOpClient();
  }

  return _supabaseClient;
}

// Create a proxy that lazily initializes the client on first access
// This ensures env vars are read at runtime, not during module load
export const supabase: any = new Proxy({} as any, {
  get(_target, prop) {
    const client = initClient();
    const value = client[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
