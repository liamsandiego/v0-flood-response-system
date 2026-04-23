"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { supabaseAuth } from "@/lib/supabase"
import type { User as SupabaseUser } from "@supabase/supabase-js"

function DynLoader({ label }: { label: string }) {
  return (
    <div className="h-screen w-screen bg-slate-950 flex flex-col items-center justify-center gap-3">
      <div className="h-8 w-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
      <div className="text-white/50 text-sm font-mono animate-pulse">RAPID RELAY — Loading {label}...</div>
    </div>
  )
}

const LoginWithGlobe = dynamic(
  () => import("@/components/login-globe").catch((err) => {
    console.error("[dynamic] Failed to load login-globe:", err)
    return { default: () => <div className="h-screen w-screen bg-slate-950 flex items-center justify-center"><div className="text-red-400 font-mono text-sm">Failed to load login. Check console and reload.</div></div> }
  }),
  { ssr: false, loading: () => <DynLoader label="Login" /> }
)
const AppShell = dynamic(
  () => import("@/components/app-shell").catch((err) => {
    console.error("[dynamic] Failed to load app-shell:", err)
    return { default: () => <div className="h-screen w-screen bg-slate-950 flex items-center justify-center"><div className="text-red-400 font-mono text-sm">Failed to load dashboard. Check console and reload.</div></div> }
  }),
  { ssr: false, loading: () => <DynLoader label="Dashboard" /> }
)

export type UserRole = "admin" | "operator" | "viewer"

interface User {
  id: string
  email: string
  username: string
  role: UserRole
  name: string
}

interface AuthContextType {
  user: User | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Timeouts
// Auth_LOGIN: 30 s — must survive Supabase cold-start + refresh-token round-trip
//             on Vercel prod (token refresh + fetchProfile in series = up to 12 s).
// AUTH_RESET / AUTH_LOGOUT: kept short, they don't refresh tokens.
// NOTE: AUTH_INIT_TIMEOUT_MS is intentionally removed. Session bootstrap is now
// handled exclusively by the INITIAL_SESSION event from onAuthStateChange, so
// there is no separate timeout-wrapped getSession() race anymore.
// ---------------------------------------------------------------------------
const AUTH_LOGIN_TIMEOUT_MS   = 30_000
const AUTH_RESET_TIMEOUT_MS   = 10_000
const AUTH_LOGOUT_TIMEOUT_MS  = 4_000

async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })
    return await Promise.race([Promise.resolve(promise), timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

type ProfileRow = { username: string; full_name: string; role: string }

async function fetchProfile(authUser: SupabaseUser): Promise<User> {
  // Hard 5 s cap — if the profiles table is slow or RLS blocks the query,
  // we must not hang. Fall back to email-derived viewer info instead.
  const profilePromise = supabaseAuth
    .from("profiles")
    .select("username, full_name, role")
    .eq("id", authUser.id)
    .single()

  let data: ProfileRow | null = null
  try {
    const result = await withTimeout(profilePromise, 5_000, "fetchProfile timed out")
    data = result.data as ProfileRow | null
  } catch (err) {
    console.warn("[Auth] fetchProfile failed, using fallback:", err instanceof Error ? err.message : err)
  }

  if (data) {
    return {
      id: authUser.id,
      email: authUser.email ?? "",
      username: data.username,
      role: data.role as UserRole,
      name: data.full_name || data.username,
    }
  }

  // No profile row or timed out — fall back to email-derived info with viewer role
  const emailName = (authUser.email ?? "user").split("@")[0]
  return {
    id: authUser.id,
    email: authUser.email ?? "",
    username: emailName,
    role: "viewer" as UserRole,
    name: emailName,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    // ── Single source of truth for all auth state changes ────────────────────
    //
    // We intentionally do NOT call getSession() here in parallel.
    //
    // Supabase always emits INITIAL_SESSION on mount, which is the canonical
    // signal for session hydration. Running getSession() simultaneously creates
    // a race: both fire fetchProfile() and both call setUser()/setIsLoading(),
    // causing the session to sometimes be dropped or the loading spinner to
    // hang permanently. Removing the parallel getSession() call fixes this.
    //
    // On refresh:
    //   - If token is still valid → INITIAL_SESSION fires with a session →
    //     fetchProfile() resolves → setUser() called → isLoading = false.
    //   - If token expired → Supabase internally refreshes via refresh token,
    //     THEN fires INITIAL_SESSION (this is the network call that previously
    //     caused the 20 s timeout to race against getSession).
    //   - If no session → INITIAL_SESSION fires with null → setUser(null) →
    //     isLoading = false → login screen shown immediately.
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange(
      async (event: string, session: { user: SupabaseUser } | null) => {
        try {
          if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
            const profile = await fetchProfile(session.user)
            if (active) setUser(profile)
          } else if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) {
            if (active) setUser(null)
          }
          // TOKEN_REFRESHED: session is valid, keep existing user state (no-op).
          // SIGNED_OUT caused by token expiry with no refresh token will be caught
          // by the SIGNED_OUT branch above.
        } catch (err) {
          console.warn("[Auth] onAuthStateChange handler failed:", err)
          // If fetchProfile failed during INITIAL_SESSION, still unblock the UI.
          if (event === "INITIAL_SESSION" && active) setIsLoading(false)
        } finally {
          // INITIAL_SESSION is emitted exactly once on mount — it marks the end
          // of the Supabase auth bootstrap phase.
          if (event === "INITIAL_SESSION" && active) {
            setIsLoading(false)
          }
        }
      }
    )

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  // ── login ──────────────────────────────────────────────────────────────────
  // Deliberately does NOT call fetchProfile or setUser here.
  // onAuthStateChange fires SIGNED_IN after a successful signInWithPassword
  // and handles setUser as the single source of truth. Calling setUser in two
  // places simultaneously was the root cause of the refresh-required bug.
  const login = useCallback(async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await withTimeout(
        supabaseAuth.auth.signInWithPassword({ email: email.trim(), password }),
        AUTH_LOGIN_TIMEOUT_MS,
        "Login timed out. Check your connection and try again."
      )
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Login failed" }
    }
  }, [])

  // ── logout ─────────────────────────────────────────────────────────────────
  // Always clear local auth quickly so the UI is responsive even when network
  // connectivity is poor. Using scope:"local" avoids waiting on remote token
  // revocation during normal user logout.
  const logout = useCallback(async () => {
    try {
      await withTimeout(
        supabaseAuth.auth.signOut({ scope: "local" }),
        AUTH_LOGOUT_TIMEOUT_MS,
        "Logout timed out"
      )
    } catch (err) {
      console.warn("[Auth] signOut failed, clearing local state anyway:", err)
    } finally {
      setUser(null)
    }
  }, [])

  // ── resetPassword ──────────────────────────────────────────────────────────
  const resetPassword = useCallback(async (
    email: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await withTimeout(
        supabaseAuth.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: typeof window !== "undefined"
            ? `${window.location.origin}/reset-password`
            : undefined,
        }),
        AUTH_RESET_TIMEOUT_MS,
        "Reset password request timed out"
      )
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Reset password failed" }
    }
  }, [])

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
        <div className="text-white/50 text-sm font-mono animate-pulse">RAPID RELAY — Initializing...</div>
      </div>
    )
  }

  if (!user) {
    return <LoginWithGlobe onLogin={login} onResetPassword={resetPassword} />
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <AppShell />
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
