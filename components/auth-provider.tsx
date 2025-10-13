"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
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

const AUTH_STORAGE_KEY = "rapid_relay_auth"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const storedUser = localStorage.getItem(AUTH_STORAGE_KEY)
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser)
        setUser(parsedUser)
      } catch (error) {
        console.error("Failed to parse stored user data:", error)
        localStorage.removeItem(AUTH_STORAGE_KEY)
      }
    }
    setIsLoading(false)
  }, [])

  const login = (username: string, password: string): boolean => {
    const mockUser = mockUsers[username as keyof typeof mockUsers]
    if (mockUser && mockUser.password === password) {
      const userData = {
        username,
        role: mockUser.role,
        name: mockUser.name,
      }
      setUser(userData)
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData))
      return true
    }
    return false
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  if (isLoading) {
    return null
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
