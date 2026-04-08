/**
 * lib/supabase.ts — Supabase client
 *
 * Returns a real Supabase client using env credentials.
 * Auth is always required — no LOCAL_MODE bypass.
 */

"use client";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
          select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: new Error("No Supabase client") }) }) }),
        });
        return () => noOpClient;
      },
    }
  );
  return noOpClient;
}

function buildClient() {
  if (!url || !key || url === "" || key === "") {
    console.warn("[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — auth will not work.");
    return createNoOpClient();
  }

  // Validate key format - should be a JWT starting with 'eyJ'
  if (!key.startsWith("eyJ")) {
    console.error(`[Supabase] Invalid anon key format! Key should start with 'eyJ' (JWT format).`);
    console.error(`[Supabase] Your key starts with: "${key.substring(0, 20)}..."`);
    console.error(`[Supabase] Get the correct key from: Supabase Dashboard → Project Settings → API → anon key`);
    return createNoOpClient();
  }

  console.log(`[Supabase] Connecting to ${url.substring(0, 40)}...`);

  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, {
    auth: {
      lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = buildClient();
