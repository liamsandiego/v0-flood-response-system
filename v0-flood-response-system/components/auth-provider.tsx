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
// Timeouts — kept short so failures surface quickly instead of hanging.
// getSession()/session bootstrap can still hit network during token refresh.
// Keep enough budget to avoid false logouts on slower tablet connections.
// ---------------------------------------------------------------------------
const AUTH_LOGIN_TIMEOUT_MS   = 20_000
const AUTH_INIT_TIMEOUT_MS    = 20_000
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

async function fetchProfile(authUser: SupabaseUser): Promise<User> {
  const { data } = await supabaseAuth
    .from("profiles")
    .select("username, full_name, role")
    .eq("id", authUser.id)
    .single()

  if (data) {
    return {
      id: authUser.id,
      email: authUser.email ?? "",
      username: data.username,
      role: data.role as UserRole,
      name: data.full_name || data.username,
    }
  }

  // No profile row — fall back to email-derived info with viewer role
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

    // ── 1. Restore session on page load/refresh ──────────────────────────────
    const initializeSession = async () => {
      try {
        // getSession() reads from localStorage synchronously in most cases,
        // only hitting the network when the access token is expired and needs
        // refreshing via the refresh token. Either way 8 s is plenty.
        const { data: { session } } = await withTimeout(
          supabaseAuth.auth.getSession(),
          AUTH_INIT_TIMEOUT_MS,
          "Session restore timed out"
        )
        if (!active) return
        if (session?.user) {
          const profile = await fetchProfile(session.user)
          if (active) setUser(profile)
        }
      } catch (err) {
        // Failed or timed out — just drop through and show the login screen.
        console.warn("[Auth] Session restore failed:", err instanceof Error ? err.message : err)
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void initializeSession()

    // ── 2. Single source of truth for all auth state changes ─────────────────
    // login() only calls signInWithPassword and returns the result.
    // This listener is the ONLY place that calls setUser, which eliminates
    // the race condition that previously caused the dashboard to hang and
    // require a page refresh to appear.
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange(
      async (event: string, session: { user: SupabaseUser } | null) => {
        try {
          if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
            const profile = await fetchProfile(session.user)
            if (active) setUser(profile)
          } else if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) {
            if (active) setUser(null)
          }
        } catch (err) {
          console.warn("[Auth] onAuthStateChange handler failed:", err)
        } finally {
          // INITIAL_SESSION is emitted once auth has finished bootstrap.
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
