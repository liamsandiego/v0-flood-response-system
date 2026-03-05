// =============================================================================
// RapidRelay – Performance Detection
// Detects slow connections and adjusts map quality accordingly.
// =============================================================================

export type ConnectionQuality = "fast" | "slow" | "unknown"

/** Detect effective connection quality */
export function detectConnectionQuality(): ConnectionQuality {
  if (typeof navigator === "undefined") return "unknown"

  const conn = (navigator as any).connection
  if (!conn) return "unknown"

  const type = conn.effectiveType as string | undefined
  if (type === "2g" || type === "slow-2g") return "slow"
  if (type === "3g") return "slow"

  // Also check downlink speed (Mbps)
  const downlink = conn.downlink as number | undefined
  if (downlink !== undefined && downlink < 1.5) return "slow"

  return "fast"
}

/** Get recommended tile size based on connection */
export function getRecommendedTileSize(): 256 | 512 {
  return detectConnectionQuality() === "slow" ? 256 : 256 // always 256 to save bandwidth
}

/** Should we reduce tile quality? */
export function shouldReduceQuality(): boolean {
  return detectConnectionQuality() === "slow"
}

/** Listen for connection changes */
export function onConnectionChange(callback: (quality: ConnectionQuality) => void): () => void {
  if (typeof navigator === "undefined") return () => {}

  const conn = (navigator as any).connection
  if (!conn) return () => {}

  const handler = () => callback(detectConnectionQuality())
  conn.addEventListener("change", handler)
  return () => conn.removeEventListener("change", handler)
}
