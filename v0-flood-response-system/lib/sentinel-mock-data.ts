// =============================================================================
// RapidRelay – Sentinel-1 Mock Flood Extent Data
//
// Simulated SAR-derived flood detection for Obando, Bulacan area.
// GeoJSON polygons representing water/flood areas at different dates.
// Realistic coordinates around the PAGASA Obando deployment zone.
//
// Three scenarios:
//   1. Normal (Mar 1) — just rivers / ponds
//   2. Warning (Mar 3) — low-lying fields beginning to flood
//   3. Critical (Mar 5) — widespread flooding in Zones B+C
// =============================================================================

export interface FloodExtentRecord {
  /** Unique identifier matching Sentinel-1 scene naming */
  id: string
  /** Acquisition timestamp (ISO 8601) */
  date: string
  /** Flood status derived from area analysis */
  status: "normal" | "warning" | "critical"
  /** Human-readable description */
  description: string
  /** Total detected flood area in hectares */
  floodAreaHa: number
  /** Number of detected flood polygons */
  polygonCount: number
  /** GeoJSON FeatureCollection with flood extents */
  geojson: GeoJSON.FeatureCollection
}

// ---------------------------------------------------------------------------
// Helper: polygon ring must close (first == last coordinate)
// ---------------------------------------------------------------------------
function ring(coords: [number, number][]): [number, number][] {
  const closed = [...coords]
  if (
    closed[0][0] !== closed[closed.length - 1][0] ||
    closed[0][1] !== closed[closed.length - 1][1]
  ) {
    closed.push([...closed[0]] as [number, number])
  }
  return closed
}

// ---------------------------------------------------------------------------
// Scenario 1: Normal conditions (March 1)
// ---------------------------------------------------------------------------
const normalFeatures: GeoJSON.Feature[] = [
  // Obando River (permanent water body)
  {
    type: "Feature",
    properties: {
      type: "water",
      zone: null,
      label: "Obando River",
      confidence: 0.96,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9320, 14.7120],
          [120.9325, 14.7122],
          [120.9360, 14.7100],
          [120.9365, 14.7095],
          [120.9360, 14.7092],
          [120.9325, 14.7115],
          [120.9320, 14.7120],
        ]),
      ],
    },
  },
  // Small fishpond near dike
  {
    type: "Feature",
    properties: {
      type: "water",
      zone: null,
      label: "Fishpond",
      confidence: 0.93,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9380, 14.7070],
          [120.9390, 14.7070],
          [120.9390, 14.7062],
          [120.9380, 14.7062],
        ]),
      ],
    },
  },
]

// ---------------------------------------------------------------------------
// Scenario 2: Warning — low-lying areas beginning to flood (March 3)
// ---------------------------------------------------------------------------
const warningFeatures: GeoJSON.Feature[] = [
  // Obando River (expanded due to rising levels)
  {
    type: "Feature",
    properties: {
      type: "water",
      zone: null,
      label: "Obando River (swollen)",
      confidence: 0.95,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9315, 14.7125],
          [120.9330, 14.7128],
          [120.9365, 14.7105],
          [120.9370, 14.7098],
          [120.9365, 14.7088],
          [120.9330, 14.7112],
          [120.9315, 14.7118],
        ]),
      ],
    },
  },
  // Zone C — agricultural fields beginning to flood
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "C",
      label: "Rice paddies east (early flood)",
      confidence: 0.78,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9380, 14.7040],
          [120.9410, 14.7040],
          [120.9410, 14.7020],
          [120.9380, 14.7020],
        ]),
      ],
    },
  },
  // Zone C — low-lying road near Sta. Cruz
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "C",
      label: "Low road near Sta. Cruz",
      confidence: 0.82,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9340, 14.7050],
          [120.9360, 14.7050],
          [120.9360, 14.7042],
          [120.9340, 14.7042],
        ]),
      ],
    },
  },
  // Fishpond overflowing
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: null,
      label: "Fishpond overflow",
      confidence: 0.85,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9375, 14.7075],
          [120.9395, 14.7075],
          [120.9395, 14.7058],
          [120.9375, 14.7058],
        ]),
      ],
    },
  },
]

// ---------------------------------------------------------------------------
// Scenario 3: Critical — widespread flooding (March 5)
// ---------------------------------------------------------------------------
const criticalFeatures: GeoJSON.Feature[] = [
  // River completely overflowed
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "A",
      label: "Obando River overflow (dike breach area)",
      confidence: 0.94,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9310, 14.7130],
          [120.9340, 14.7135],
          [120.9370, 14.7110],
          [120.9380, 14.7095],
          [120.9375, 14.7080],
          [120.9340, 14.7085],
          [120.9315, 14.7110],
        ]),
      ],
    },
  },
  // Zone B — residential flooding (Tawiran-Paco)
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "B",
      label: "Tawiran-Paco residential flooding",
      confidence: 0.91,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9340, 14.7080],
          [120.9380, 14.7080],
          [120.9380, 14.7055],
          [120.9340, 14.7055],
        ]),
      ],
    },
  },
  // Zone B — near barangay hall
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "B",
      label: "Barangay hall area flooding",
      confidence: 0.88,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9295, 14.7080],
          [120.9335, 14.7080],
          [120.9335, 14.7060],
          [120.9295, 14.7060],
        ]),
      ],
    },
  },
  // Zone C — fields completely flooded
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "C",
      label: "Rice fields — total inundation",
      confidence: 0.92,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9370, 14.7050],
          [120.9420, 14.7050],
          [120.9420, 14.7010],
          [120.9370, 14.7010],
        ]),
      ],
    },
  },
  // Zone C — south fields
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "C",
      label: "Southern agricultural area",
      confidence: 0.85,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9320, 14.7040],
          [120.9370, 14.7040],
          [120.9370, 14.7015],
          [120.9320, 14.7015],
        ]),
      ],
    },
  },
  // Zone A — dike frontage
  {
    type: "Feature",
    properties: {
      type: "flood",
      zone: "A",
      label: "Dike frontage — critical water level",
      confidence: 0.96,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring([
          [120.9340, 14.7115],
          [120.9380, 14.7115],
          [120.9380, 14.7095],
          [120.9340, 14.7095],
        ]),
      ],
    },
  },
]

// ---------------------------------------------------------------------------
// Export the three mock scenarios
// ---------------------------------------------------------------------------
export const mockFloodExtents: FloodExtentRecord[] = [
  {
    id: "S1A_20260301",
    date: "2026-03-01T10:30:00Z",
    status: "normal",
    description: "Normal conditions — rivers and ponds within expected levels",
    floodAreaHa: 1.2,
    polygonCount: normalFeatures.length,
    geojson: { type: "FeatureCollection", features: normalFeatures },
  },
  {
    id: "S1A_20260303",
    date: "2026-03-03T10:30:00Z",
    status: "warning",
    description: "Warning — low-lying fields and roads beginning to flood",
    floodAreaHa: 8.7,
    polygonCount: warningFeatures.length,
    geojson: { type: "FeatureCollection", features: warningFeatures },
  },
  {
    id: "S1A_20260305",
    date: "2026-03-05T10:30:00Z",
    status: "critical",
    description: "Critical — widespread flooding across Zones A, B, C",
    floodAreaHa: 34.2,
    polygonCount: criticalFeatures.length,
    geojson: { type: "FeatureCollection", features: criticalFeatures },
  },
]

/** Find extent by ID, or return the latest */
export function getFloodExtent(id: string | null): FloodExtentRecord | undefined {
  if (!id) return mockFloodExtents[mockFloodExtents.length - 1]
  return mockFloodExtents.find((e) => e.id === id)
}
