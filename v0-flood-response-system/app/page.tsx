"use client"

import { AuthProvider } from "@/components/auth-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { ErrorBoundary } from "@/components/error-boundary"

export default function Home() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>{/* Dashboard will be shown after login */}</AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
