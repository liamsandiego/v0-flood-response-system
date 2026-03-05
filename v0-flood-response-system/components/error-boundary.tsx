"use client"

import React, { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
}

const MAX_AUTO_RETRIES = 3

/**
 * Error Boundary that catches render crashes and:
 * 1. Logs the error with context
 * 2. Attempts automatic recovery (re-render) up to MAX_AUTO_RETRIES
 * 3. Shows a fallback UI with manual recovery option
 *
 * This prevents partial code crashes from taking down the entire app.
 */
export class ErrorBoundary extends Component<Props, State> {
  private retryTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error)
    if (errorInfo.componentStack) {
      console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack)
    }

    this.props.onError?.(error, errorInfo)

    // Do NOT auto-retry infinite loop errors — they will just re-trigger
    const isInfiniteLoop =
      error.message?.includes("Maximum update depth") ||
      error.message?.includes("Too many re-renders")

    if (isInfiniteLoop) {
      console.warn("[ErrorBoundary] Infinite loop detected — skipping auto-retry.")
      return
    }

    // Auto-retry transient errors after a delay if under the limit
    if (this.state.retryCount < MAX_AUTO_RETRIES) {
      this.retryTimeout = setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
        }))
      }, 2000 * (this.state.retryCount + 1))
    }
  }

  componentWillUnmount() {
    if (this.retryTimeout) clearTimeout(this.retryTimeout)
  }

  handleManualRetry = () => {
    this.setState({ hasError: false, error: null, retryCount: 0 })
  }

  handleFullReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      const isAutoRetrying = this.state.retryCount < MAX_AUTO_RETRIES

      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-6 border border-red-300 rounded-lg bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <div className="text-red-600 dark:text-red-400 text-lg font-semibold mb-2">
            ⚠️ Component Error
          </div>
          <p className="text-sm text-muted-foreground text-center mb-4 max-w-md">
            {isAutoRetrying
              ? `Attempting automatic recovery (${this.state.retryCount + 1}/${MAX_AUTO_RETRIES})...`
              : `A component has crashed. The monitoring system is still running.`}
          </p>
          {this.state.error && (
            <pre className="text-xs text-red-500 bg-red-100 dark:bg-red-950/40 p-2 rounded mb-4 max-w-md overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          {!isAutoRetrying && (
            <div className="flex gap-2">
              <button
                onClick={this.handleManualRetry}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:opacity-90"
              >
                Retry Component
              </button>
              <button
                onClick={this.handleFullReload}
                className="px-4 py-2 text-sm border border-border rounded hover:bg-accent"
              >
                Full Reload
              </button>
            </div>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
