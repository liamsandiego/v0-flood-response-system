// =============================================================================
// RapidRelay – RainViewer API Client
// Handles fetching with timeout, retry, AbortController, and caching.
// API: https://api.rainviewer.com/public/weather-maps.json (free, no key)
// =============================================================================

export interface RainViewerFrame {
  time: number    // Unix timestamp (seconds)
  path: string    // Tile path fragment
}

export interface RainViewerData {
  host: string
  past: RainViewerFrame[]
  nowcast: RainViewerFrame[]
  generated: number
}

const API_URL = "https://api.rainviewer.com/public/weather-maps.json"
const FETCH_TIMEOUT_MS = 8000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const TILE_SIZE = 256

// ── In-memory cache ──────────────────────────────────────────────────────
let cachedData: RainViewerData | null = null
let cachedAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function isCacheValid(): boolean {
  return cachedData !== null && Date.now() - cachedAt < CACHE_TTL_MS
}

// ── Fetch with timeout ───────────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  // Chain with external abort signal
  if (signal) {
    signal.addEventListener("abort", () => controller.abort())
  }

  try {
    const res = await fetch(url, { signal: controller.signal })
    return res
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Fetch with retry + exponential backoff ───────────────────────────────
export async function fetchRainViewerData(
  signal?: AbortSignal
): Promise<RainViewerData> {
  // Return cache if fresh
  if (isCacheValid()) return cachedData!

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

      const res = await fetchWithTimeout(API_URL, FETCH_TIMEOUT_MS, signal)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

      const json = await res.json()

      const data: RainViewerData = {
        host: json.host ?? "https://tilecache.rainviewer.com",
        past: json.radar?.past ?? [],
        nowcast: json.radar?.nowcast ?? [],
        generated: json.generated ?? Math.floor(Date.now() / 1000),
      }

      // Update cache
      cachedData = data
      cachedAt = Date.now()

      return data
    } catch (err: any) {
      if (err.name === "AbortError") throw err
      lastError = err
      console.warn(`[RainViewer] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, err.message)

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
      }
    }
  }

  // If we had cached data (stale), return it as fallback
  if (cachedData) {
    console.warn("[RainViewer] Returning stale cache after all retries failed")
    return cachedData
  }

  throw lastError ?? new Error("Failed to fetch RainViewer data")
}

// ── Build tile URL ───────────────────────────────────────────────────────
export function buildTileUrl(
  host: string,
  frame: RainViewerFrame,
  colorScheme: number,
  smooth: boolean,
  snow: boolean
): string {
  const sm = smooth ? 1 : 0
  const sn = snow ? 1 : 0
  return `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${colorScheme}/${sm}_${sn}.png`
}

// ── Format frame time for display ────────────────────────────────────────
export function formatFrameTime(frame: RainViewerFrame): string {
  const d = new Date(frame.time * 1000)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function formatFrameRelative(frame: RainViewerFrame): string {
  const diffMin = Math.round((Date.now() / 1000 - frame.time) / 60)
  if (diffMin <= 0) return "Now"
  if (diffMin < 60) return `${diffMin} min ago`
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  return `${h}h ${m}m ago`
}

// ── Rain intensity legend data ───────────────────────────────────────────
export const RAIN_INTENSITY_LEGEND = [
  { label: "Light", color: "#88ff88", dbz: "5–20 dBZ", mmh: "< 2.5 mm/h" },
  { label: "Moderate", color: "#ffff00", dbz: "20–35 dBZ", mmh: "2.5–7.5 mm/h" },
  { label: "Heavy", color: "#ff8800", dbz: "35–50 dBZ", mmh: "7.5–50 mm/h" },
  { label: "Extreme", color: "#ff0000", dbz: "50+ dBZ", mmh: "> 50 mm/h" },
]
