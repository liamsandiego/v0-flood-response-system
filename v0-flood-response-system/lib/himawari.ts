// =============================================================================
// RapidRelay – Himawari-9 satellite utilities
//
// Zoom Earth-style approach: generate all frame URLs upfront so the map
// can mount ALL sources permanently. Only opacity toggles — no source
// teardown, no tile re-fetch. Once tiles load they stay in GPU cache.
//
// Uses GIBS `all` endpoint with ISO 8601 timestamps for hourly resolution.
// Verified: GET .../all/.../2026-03-15T04:00:00Z/GoogleMapsCompatible_Level6/4/7/13.png → 200 OK
// =============================================================================

export interface HimawariFrame {
  /** ISO 8601 timestamp, e.g. "2026-03-15T04:00:00Z" */
  time: string
  /** Human-readable label, e.g. "12:00 PHT" */
  label: string
  /** Pre-computed GIBS WMTS tile URL template with {z}/{y}/{x} */
  url: string
}

/** GIBS data latency — imagery typically 3-5 hours behind real time */
const GIBS_DELAY_HOURS = 4

/**
 * Generate Himawari frames with pre-computed tile URLs.
 * Uses GIBS `all` endpoint with ISO 8601 timestamps for hourly resolution.
 *
 * @param product - "infrared" or "visible"
 * @param hours - how many hours back (default 24 → 24 frames)
 */
export function generateHimawariFrames(
  product: "infrared" | "visible",
  hours = 24
): HimawariFrame[] {
  const now = Date.now()
  const latestAvailable = now - GIBS_DELAY_HOURS * 3600_000
  // Snap to last whole hour
  const snapped = Math.floor(latestAvailable / 3600_000) * 3600_000

  const layer = product === "infrared"
    ? "Himawari_AHI_Band13_Clean_Infrared"
    : "Himawari_AHI_Band3_Red_Visible_1km"
  const tileMatrix = product === "infrared"
    ? "GoogleMapsCompatible_Level6"
    : "GoogleMapsCompatible_Level7"

  const frames: HimawariFrame[] = []

  for (let i = hours - 1; i >= 0; i--) {
    const ts = snapped - i * 3600_000
    const d = new Date(ts)
    const time = d.toISOString().replace(".000Z", "Z").replace(/\.\d{3}Z$/, "Z")
    frames.push({
      time,
      label: formatPHT(d),
      url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/all/${layer}/default/${time}/${tileMatrix}/{z}/{y}/{x}.png`,
    })
  }

  return frames
}

/** Format a Date as "HH:00 PHT" (UTC+8) */
function formatPHT(d: Date): string {
  const phHour = (d.getUTCHours() + 8) % 24
  return `${String(phHour).padStart(2, "0")}:00 PHT`
}

/** Max zoom for a given Himawari product */
export function getHimawariMaxZoom(product: "infrared" | "visible"): number {
  return product === "visible" ? 7 : 6
}
