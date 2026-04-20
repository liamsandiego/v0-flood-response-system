"use client"

import type React from "react"
import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Droplets, AlertCircle, Eye, EyeOff } from "lucide-react"
import { DEPLOYMENT } from "@/lib/constants"

const GlobeMap = dynamic(() => import("@/components/globe/GlobeMap"), {
  ssr: false,
})

interface LoginGlobeProps {
  onLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  onResetPassword?: (email: string) => Promise<{ success: boolean; error?: string }>
}

export default function LoginWithGlobe({ onLogin, onResetPassword }: LoginGlobeProps) {
  const [view, setView] = useState<"login" | "forgot_password">("login")
  const [emailLogin, setEmailLogin] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showGlobe, setShowGlobe] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const nav = navigator as Navigator & {
      connection?: {
        effectiveType?: string
        saveData?: boolean
      }
    }

    const effectiveType = nav.connection?.effectiveType?.toLowerCase()
    const constrained = nav.connection?.saveData || effectiveType === "2g" || effectiveType === "slow-2g"

    if (constrained) {
      setShowGlobe(false)
      return
    }

    const timer = window.setTimeout(() => setShowGlobe(true), 300)
    return () => window.clearTimeout(timer)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccessMsg("")
    setLoading(true)
    try {
      const result = await onLogin(emailLogin.trim(), password)

      if (!result.success) {
        setError(result.error || "Invalid username or password")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!onResetPassword) return
    setError("")
    setSuccessMsg("")
    setLoading(true)
    try {
      const result = await onResetPassword(email.trim())

      if (!result.success) {
        setError(result.error || "Failed to send reset email")
      } else {
        setSuccessMsg("Check your email for the reset link")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset email")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-slate-950">
      {/* Globe background */}
      <div className="absolute inset-0 z-0">
        {showGlobe ? (
          <div className="login-map-canvas h-full w-full">
            <GlobeMap />
          </div>
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.12),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(14,116,144,0.22),transparent_40%),linear-gradient(160deg,#020617_0%,#0f172a_52%,#111827_100%)]" />
        )}
      </div>

      {/* Dark overlay for readability */}
      <div className="absolute inset-0 z-10 bg-slate-950/40" />

      {/* Login card */}
      <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
        <div className="w-full max-w-sm backdrop-blur-xl bg-slate-900/60 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="text-center pt-8 pb-4 px-6">
            <div className="mx-auto w-14 h-14 bg-cyan-500 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/20">
              <Droplets className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">RAPID RELAY</h1>
            <p className="text-xs text-white/50 mt-1">Flood Early Warning System</p>
            <p className="text-[10px] text-white/30 mt-0.5">{DEPLOYMENT.name}</p>
          </div>

          {/* Form */}
          {view === "login" ? (
            <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login-user" className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                  Email
                </label>
                <input
                  id="login-user"
                  type="email"
                  placeholder="Enter your email"
                  value={emailLogin}
                  onChange={(e) => setEmailLogin(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="login-pass" className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setView("forgot_password")
                      setError("")
                      setSuccessMsg("")
                    }}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300"
                  >
                    Forgot?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-pass"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 pr-10 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                  <span className="text-xs text-red-300">{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-500/20"
              >
                {loading ? "SIGNING IN..." : "LOG IN"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="px-6 pb-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-email" className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  id="reset-email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                  <span className="text-xs text-red-300">{error}</span>
                </div>
              )}

              {successMsg && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                  <span className="text-xs text-green-400">{successMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !!successMsg}
                className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-500/20"
              >
                {loading ? "SENDING..." : "RESET PASSWORD"}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setView("login")
                    setError("")
                    setSuccessMsg("")
                  }}
                  className="text-xs text-white/50 hover:text-white/80"
                >
                  Back to Login
                </button>
              </div>
            </form>
          )}

          {/* Access note */}
          <div className="px-6 pb-5 pt-0">
            <div className="border-t border-white/5 pt-3 text-center">
              <p className="text-[10px] text-white/30">
                Contact your system administrator for access credentials
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
