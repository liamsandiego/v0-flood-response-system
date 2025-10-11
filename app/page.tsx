"use client"

import { AuthProvider } from "@/components/auth-provider"

export default function Home() {
  return <AuthProvider>{/* Dashboard will be shown after login */}</AuthProvider>
}
