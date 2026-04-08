"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Droplets, Eye, EyeOff, CheckCircle, AlertCircle, Lock } from "lucide-react"
import dynamic from "next/dynamic"

const GlobeMap = dynamic(() => import("@/components/globe/GlobeMap"), { ssr: false })

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")
  const [error, setError] = useState("")
  const [sessionReady, setSessionReady] = useState(false)

  // Supabase listens to the hash fragment (#access_token=...) from the email link
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const validate = () => {
    if (password.length < 8) return "Password must be at least 8 characters"
    if (password !== confirm) return "Passwords do not match"
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError("")
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setStatus("error")
    } else {
      setStatus("success")
    }
    setLoading(false)
  }

  const strength = (() => {
    if (!password) return 0
    let score = 0
    if (password.length >= 8) score++
    if (password.length >= 12) score++
    if (/[A-Z]/.test(password)) score++
    if (/[0-9]/.test(password)) score++
    if (/[^A-Za-z0-9]/.test(password)) score++
    return score
  })()

  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong", "Very Strong"][strength]
  const strengthColor = ["", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-500", "bg-emerald-500"][strength]

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-slate-950">
      {/* Globe background */}
      <div className="absolute inset-0 z-0">
        <GlobeMap />
      </div>
      <div className="absolute inset-0 z-10 bg-slate-950/50" />

      {/* Card */}
      <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
        <div className="w-full max-w-sm backdrop-blur-xl bg-slate-900/70 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="text-center pt-8 pb-4 px-6">
            <div className="mx-auto w-14 h-14 bg-cyan-500 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/30">
              <Lock className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Set New Password</h1>
            <p className="text-xs text-white/50 mt-1">RAPID RELAY — Flood Early Warning System</p>
          </div>

          <div className="px-6 pb-8 space-y-4">
            {status === "success" ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle className="h-12 w-12 text-green-400" />
                  <div className="text-center">
                    <p className="text-white font-semibold">Password Updated!</p>
                    <p className="text-white/50 text-xs mt-1">Your password has been changed successfully.</p>
                  </div>
                </div>
                <a
                  href="/"
                  className="block w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-sm text-center transition-all shadow-lg shadow-cyan-500/20"
                >
                  Back to Login
                </a>
              </div>
            ) : !sessionReady ? (
              <div className="py-6 text-center space-y-3">
                <div className="h-8 w-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mx-auto" />
                <p className="text-white/50 text-sm">Verifying reset link…</p>
                <p className="text-white/30 text-xs">
                  If this takes too long, your link may have expired.{" "}
                  <a href="/" className="text-cyan-400 hover:underline">Request a new one.</a>
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* New Password */}
                <div className="space-y-1.5">
                  <label htmlFor="rp-password" className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="rp-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Min. 8 characters"
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
                  {/* Strength bar */}
                  {password && (
                    <div className="space-y-1 pt-0.5">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-all ${i <= strength ? strengthColor : "bg-white/10"}`}
                          />
                        ))}
                      </div>
                      <p className={`text-[10px] ${strengthColor.replace("bg-", "text-")}`}>{strengthLabel}</p>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label htmlFor="rp-confirm" className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="rp-confirm"
                      type={showConfirm ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      placeholder="Repeat new password"
                      className={`w-full px-3 py-2.5 pr-10 rounded-lg bg-white/5 border text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 transition-all ${
                        confirm && password !== confirm
                          ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/30"
                          : "border-white/10 focus:border-cyan-500/50 focus:ring-cyan-500/30"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {confirm && password !== confirm && (
                    <p className="text-[10px] text-red-400">Passwords do not match</p>
                  )}
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
                  {loading ? "UPDATING..." : "UPDATE PASSWORD"}
                </button>

                <div className="text-center">
                  <a href="/" className="text-[10px] text-white/30 hover:text-white/60 transition-colors">
                    Cancel — back to login
                  </a>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
