"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { LoginScreen } from "@/components/login-screen"
import { Dashboard } from "@/components/dashboard"

export type UserRole = "admin" | "operator" | "viewer"

interface User {
  username: string
  role: UserRole
  name: string
}

interface AuthContextType {
  user: User | null
  login: (username: string, password: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Mock user database
const mockUsers = {
  admin: { password: "admin123", role: "admin" as UserRole, name: "Admin User" },
  operator: { password: "operator123", role: "operator" as UserRole, name: "Operator User" },
  viewer: { password: "viewer123", role: "viewer" as UserRole, name: "Viewer User" },
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const login = (username: string, password: string): boolean => {
    const mockUser = mockUsers[username as keyof typeof mockUsers]
    if (mockUser && mockUser.password === password) {
      setUser({
        username,
        role: mockUser.role,
        name: mockUser.name,
      })
      return true
    }
    return false
  }

  const logout = () => {
    setUser(null)
  }

  if (!user) {
    return <LoginScreen onLogin={login} />
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <Dashboard user={user} onLogout={logout} />
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
