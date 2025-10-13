"use client"

import { AuthProvider } from "@/components/auth-provider"
import { ThemeProvider } from "@/components/theme-provider"

export default function Home() {
  return (
    <ThemeProvider>
      <AuthProvider>{/* Dashboard will be shown after login */}</AuthProvider>
    </ThemeProvider>
  )
}
