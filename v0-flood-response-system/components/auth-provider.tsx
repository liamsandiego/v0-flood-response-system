"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { supabase } from "@/lib/supabase"
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

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function fetchProfile(authUser: SupabaseUser): Promise<User> {
  const { data } = await supabase
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
    // Check existing session (5s timeout so we don't hang forever)
    const timeout = setTimeout(() => {
      console.warn("[Auth] Supabase session check timed out — showing login")
      setIsLoading(false)
    }, 5000)

    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: { user: SupabaseUser } | null } }) => {
      clearTimeout(timeout)
      if (session?.user) {
        const profile = await fetchProfile(session.user)
        setUser(profile)
      }
      setIsLoading(false)
    }).catch(() => {
      clearTimeout(timeout)
      console.error("[Auth] Failed to check session — showing login")
      setIsLoading(false)
    })

    // Listen for auth state changes — handles sign-in and sign-out automatically
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: string, session: { user: SupabaseUser } | null) => {
        if (event === "SIGNED_IN" && session?.user) {
          const profile = await fetchProfile(session.user)
          setUser(profile)
        } else if (event === "SIGNED_OUT") {
          setUser(null)
        }
      }
    )

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  // Login requires a valid Supabase email + password — no bypass
  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { success: false, error: error.message }
    return { success: true }
  }, [])

  // Logout: signOut triggers SIGNED_OUT → onAuthStateChange sets user to null
  const logout = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const resetPassword = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) return { success: false, error: error.message }
    return { success: true }
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
