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

// Lazy-load the login screen and app shell (both need browser APIs for globe)
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
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function fetchProfile(authUser: SupabaseUser): Promise<User | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, full_name, role")
    .eq("id", authUser.id)
    .single()

  if (error || !data) {
    console.error("[Auth] Failed to fetch profile:", error?.message)
    return null
  }

  return {
    id: authUser.id,
    email: authUser.email ?? "",
    username: data.username,
    role: data.role as UserRole,
    name: data.full_name || data.username,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // 1. Check existing session (with 5s timeout so we don't hang on "Initializing..." forever)
    const timeout = setTimeout(() => {
      console.warn("[Auth] Supabase session check timed out after 5s — showing login")
      setIsLoading(false)
    }, 5000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
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

    // 2. Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
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

  const login = useCallback(async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    // Try Supabase auth first with a 3s timeout (can hang due to lock issues)
    try {
      const email = username.includes("@") ? username : `${username}@rapidrelay.local`
      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])
      if (result && "error" in result && !result.error) return { success: true }
    } catch {
      // Supabase auth unavailable — continue to demo fallback
    }

    // Demo login — thesis project, no real user management needed
    const accounts: Record<string, { password: string; role: UserRole; name: string }> = {
      admin: { password: "admin123", role: "admin", name: "Admin User" },
      operator: { password: "operator123", role: "operator", name: "Operator User" },
    }
    const acct = accounts[username]
    if (acct && password === acct.password) {
      setUser({
        id: `demo-${username}`,
        email: `${username}@rapidrelay.local`,
        username,
        role: acct.role,
        name: acct.name,
      })
      return { success: true }
    }

    return { success: false, error: "Invalid username or password" }
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
  }, [])

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center">
        <div className="text-white/50 text-sm font-mono animate-pulse">RAPID RELAY — Initializing...</div>
      </div>
    )
  }

  if (!user) {
    return <LoginWithGlobe onLogin={login} />
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
