// =============================================================================
// Sentinel-1 GEE CSV → GeoJSON logic (port of Python sentinel_service.py)
// Used by Next.js API routes so Sentinel-1 works on Vercel without backend.
// CSV data embedded directly to avoid filesystem issues on serverless.
// =============================================================================

// ---------------------------------------------------------------------------
// Embedded GEE timeseries data (180 rows, 9 years: 2017-2026)
// ---------------------------------------------------------------------------

const CSV_RAW = `timestamp,soil_saturation,flood_extent,flood_label,wetness_trend
2017-05-26T10:05:58Z,0.46,0.07,1,0
2017-06-07T10:05:59Z,0.52,0.09,1,0
2017-06-19T10:06:00Z,0.49,0.07,1,0
2017-07-01T10:06:00Z,0.47,0.07,1,0
2017-07-13T10:06:01Z,0.43,0.08,1,0
2017-07-25T10:06:02Z,0.45,0.06,1,0
2017-08-06T10:06:03Z,0.47,0.08,1,0
2017-08-18T10:06:03Z,0.53,0.11,1,0
2017-08-30T10:06:04Z,0.44,0.08,1,0
2017-09-11T10:06:04Z,0.46,0.07,1,0
2017-09-23T10:06:05Z,0.47,0.08,1,0
2017-10-05T10:06:05Z,0.53,0.15,1,0
2017-10-17T10:06:05Z,0.46,0.07,1,0
2017-10-29T10:06:05Z,0.51,0.1,1,0
2017-11-10T10:06:05Z,0.46,0.13,1,0
2017-11-22T10:06:04Z,0.48,0.09,1,0
2017-12-04T10:06:04Z,0.53,0.14,1,0
2017-12-16T10:06:04Z,0.54,0.12,1,0
2017-12-28T10:06:03Z,0.47,0.06,1,0
2018-09-24T10:07:05Z,0.48,0.12,1,0
2018-01-09T10:06:03Z,0.48,0.09,1,0
2018-01-21T10:06:02Z,0.5,0.12,1,0
2018-02-02T10:06:02Z,0.48,0.08,1,0
2018-02-14T10:06:02Z,0.47,0.05,1,0
2018-02-26T10:06:02Z,0.49,0.07,1,0
2018-03-10T10:06:02Z,0.49,0.05,1,0
2018-03-22T10:06:02Z,0.5,0.05,1,0
2018-04-03T10:06:02Z,0.53,0.1,1,0
2018-04-15T10:06:03Z,0.55,0.1,1,0
2018-04-27T10:06:03Z,0.54,0.08,1,0
2018-05-09T10:06:04Z,0.57,0.12,1,0
2018-05-21T10:06:04Z,0.53,0.1,1,0
2018-06-02T10:06:05Z,0.52,0.08,1,0
2018-06-14T10:06:06Z,0.39,0.05,1,0
2018-06-26T10:06:07Z,0.47,0.14,1,0
2018-07-08T10:06:07Z,0.46,0.09,1,0
2018-07-08T10:06:07Z,0.46,0.09,1,0
2018-07-20T10:06:08Z,0.41,0.09,1,0
2018-08-01T10:06:09Z,0.46,0.09,1,0
2018-08-13T10:06:09Z,0.41,0.1,1,0
2018-08-25T10:06:10Z,0.44,0.08,1,0
2018-09-06T10:06:11Z,0.45,0.12,1,0
2018-09-18T10:06:11Z,0.48,0.1,1,0
2018-09-30T10:06:11Z,0.47,0.08,1,0
2018-10-12T10:06:12Z,0.52,0.13,1,0
2018-10-24T10:06:12Z,0.49,0.08,1,0
2018-11-05T10:06:12Z,0.47,0.08,1,0
2018-11-29T10:06:11Z,0.49,0.07,1,0
2018-12-11T10:06:10Z,0.5,0.09,1,0
2018-12-23T10:06:10Z,0.41,0.12,1,0
2019-01-04T10:06:10Z,0.45,0.07,1,0
2019-01-16T10:06:09Z,0.48,0.07,1,0
2019-01-28T10:06:09Z,0.48,0.06,1,0
2019-02-09T10:06:09Z,0.53,0.12,1,0
2019-02-21T10:06:08Z,0.56,0.14,1,0
2019-03-05T10:06:08Z,0.52,0.08,1,0
2019-03-17T10:06:08Z,0.56,0.14,1,0
2019-03-29T10:06:09Z,0.54,0.1,1,0
2019-04-10T10:06:09Z,0.56,0.12,1,0
2019-04-22T10:06:10Z,0.56,0.11,1,0
2019-05-04T10:06:10Z,0.53,0.09,1,0
2019-05-16T10:06:11Z,0.48,0.07,1,0
2019-05-28T10:06:11Z,0.46,0.1,1,0
2019-06-09T10:06:12Z,0.48,0.08,1,0
2019-06-21T10:06:13Z,0.48,0.08,1,0
2019-07-03T10:06:13Z,0.45,0.09,1,0
2019-07-15T10:06:14Z,0.44,0.09,1,0
2019-07-27T10:06:15Z,0.44,0.13,1,0
2019-08-08T10:06:16Z,0.37,0.05,1,0
2019-08-20T10:06:16Z,0.42,0.07,1,0
2019-09-01T10:06:17Z,0.41,0.08,1,0
2019-09-13T10:06:17Z,0.46,0.14,1,0
2019-09-25T10:06:18Z,0.5,0.14,1,0
2019-10-07T10:06:18Z,0.45,0.07,1,0
2019-10-19T10:06:18Z,0.49,0.11,1,0
2019-10-31T10:06:18Z,0.45,0.07,1,0
2019-11-12T10:06:18Z,0.46,0.1,1,0
2019-11-24T10:06:18Z,0.44,0.11,1,0
2019-12-06T10:06:17Z,0.47,0.12,1,0
2019-12-18T10:06:17Z,0.47,0.08,1,0
2019-12-30T10:06:16Z,0.47,0.09,1,0
2020-01-17T10:06:30Z,0.57,0.26,1,0
2020-01-29T10:06:34Z,0.53,0.04,1,0
2020-01-29T10:06:59Z,0.49,0.08,1,0
2020-02-10T10:06:34Z,0.5,0.02,0,0
2020-02-10T10:06:59Z,0.46,0.05,1,0
2020-02-22T10:06:34Z,0.52,0.03,1,0
2020-02-22T10:06:59Z,0.48,0.05,1,0
2020-05-16T10:06:53Z,0.46,0.1,1,0
2020-01-11T10:06:16Z,0.53,0.13,1,0
2020-01-23T10:06:15Z,0.49,0.06,1,0
2020-02-04T10:06:15Z,0.54,0.11,1,0
2020-02-16T10:06:15Z,0.56,0.14,1,0
2020-02-28T10:06:14Z,0.52,0.07,1,0
2020-03-11T10:06:15Z,0.51,0.07,1,0
2020-03-23T10:06:15Z,0.55,0.1,1,0
2020-04-04T10:06:15Z,0.56,0.1,1,0
2020-04-16T10:06:16Z,0.55,0.11,1,0
2020-04-28T10:06:16Z,0.55,0.09,1,0
2020-05-10T10:06:17Z,0.54,0.1,1,0
2020-05-22T10:06:17Z,0.47,0.08,1,0
2020-06-03T10:06:18Z,0.47,0.06,1,0
2020-06-15T10:06:19Z,0.5,0.14,1,0
2020-06-27T10:06:19Z,0.47,0.08,1,0
2020-07-09T10:06:20Z,0.46,0.08,1,0
2020-07-21T10:06:21Z,0.49,0.09,1,0
2020-08-02T10:06:22Z,0.49,0.16,1,0
2020-08-14T10:06:22Z,0.45,0.08,1,0
2020-08-26T10:06:23Z,0.45,0.07,1,0
2020-09-07T10:06:24Z,0.43,0.09,1,0
2020-09-19T10:06:24Z,0.47,0.11,1,0
2020-10-01T10:06:24Z,0.43,0.07,1,0
2020-10-13T10:06:24Z,0.47,0.11,1,0
2020-10-25T10:06:24Z,0.37,0.08,1,0
2020-11-06T10:06:24Z,0.46,0.13,1,0
2020-11-18T10:06:24Z,0.45,0.11,1,0
2020-11-30T10:06:24Z,0.4,0.06,1,0
2020-12-12T10:06:23Z,0.47,0.12,1,0
2020-12-24T10:06:22Z,0.51,0.17,1,0
2021-07-10T10:06:51Z,0.49,0.13,1,0
2021-07-10T10:07:16Z,0.47,0.04,1,0
2021-09-08T10:07:11Z,0.39,0.05,1,0
2021-01-05T10:06:22Z,0.5,0.12,1,0
2021-01-17T10:06:21Z,0.46,0.05,1,0
2021-01-29T10:06:21Z,0.47,0.05,1,0
2021-02-10T10:06:21Z,0.52,0.13,1,0
2021-02-22T10:06:20Z,0.49,0.09,1,0
2021-03-06T10:06:20Z,0.55,0.11,1,0
2021-03-18T10:06:20Z,0.54,0.11,1,0
2021-03-30T10:06:21Z,0.57,0.14,1,0
2021-04-11T10:06:21Z,0.54,0.07,1,0
2021-04-23T10:06:22Z,0.55,0.1,1,0
2021-05-05T10:06:22Z,0.53,0.06,1,0
2021-05-17T10:06:23Z,0.58,0.1,1,0
2021-05-29T10:06:24Z,0.51,0.06,1,0
2021-06-10T10:06:24Z,0.46,0.08,1,0
2021-06-22T10:06:25Z,0.43,0.04,0,0
2021-07-16T10:06:26Z,0.48,0.06,1,0
2021-07-28T10:06:27Z,0.39,0.08,1,0
2021-08-09T10:06:28Z,0.45,0.07,1,0
2021-08-21T10:06:28Z,0.41,0.06,1,0
2021-09-02T10:06:29Z,0.45,0.07,1,0
2021-09-14T10:06:29Z,0.45,0.08,1,0
2021-09-26T10:06:30Z,0.55,0.15,1,0
2021-10-08T10:06:30Z,0.51,0.14,1,0
2021-10-20T10:06:30Z,0.48,0.13,1,0
2021-11-01T10:06:30Z,0.46,0.06,1,0
2021-11-13T10:06:30Z,0.51,0.1,1,0
2021-11-25T10:06:29Z,0.49,0.07,1,0
2021-12-07T10:06:29Z,0.49,0.06,1,0
2021-12-19T10:06:28Z,0.49,0.13,1,0
2024-07-30T10:07:12Z,0.38,0.08,1,0
2024-11-27T10:07:21Z,0.52,0.05,1,0
2025-04-02T10:05:57Z,0.63,0.18,1,-1
2025-04-14T10:05:57Z,0.57,0.11,1,-1
2025-04-26T10:05:58Z,0.59,0.11,1,-1
2025-05-08T10:05:59Z,0.59,0.14,1,-1
2025-06-01T10:06:01Z,0.47,0.07,1,-1
2025-06-13T10:06:02Z,0.5,0.13,1,-1
2025-06-25T10:06:03Z,0.46,0.08,1,-1
2025-07-07T10:06:03Z,0.44,0.07,1,-1
2025-07-19T10:06:04Z,0.36,0.05,1,-1
2025-07-31T10:06:05Z,0.43,0.07,1,-1
2025-08-12T10:06:05Z,0.44,0.08,1,-1
2025-08-24T10:06:06Z,0.48,0.13,1,-1
2025-09-05T10:06:06Z,0.43,0.09,1,-1
2025-09-17T10:05:58Z,0.42,0.08,1,-1
2025-09-29T10:05:58Z,0.5,0.17,1,-1
2025-10-11T10:05:59Z,0.45,0.12,1,-1
2025-10-23T10:05:59Z,0.46,0.11,1,-1
2025-11-04T10:05:58Z,0.4,0.09,1,-1
2025-11-16T10:05:58Z,0.44,0.09,1,-1
2025-11-28T10:05:57Z,0.45,0.1,1,-1
2025-12-10T10:05:57Z,0.45,0.08,1,-1
2025-12-22T10:05:56Z,0.45,0.09,1,-1
2026-01-03T10:05:55Z,0.43,0.06,1,1
2026-01-15T10:05:55Z,0.48,0.08,1,1
2026-01-27T10:05:55Z,0.55,0.13,1,1
2026-02-08T10:05:54Z,0.47,0.06,1,1
2026-02-20T10:05:54Z,0.52,0.09,1,1`;

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

interface CsvRow {
  timestamp: string;
  soil_saturation: string;
  flood_extent: string;
  flood_label: string;
  wetness_trend: string;
}

let _cachedRows: CsvRow[] | null = null;

function readCsvRows(): CsvRow[] {
  if (_cachedRows) return _cachedRows;
  const lines = CSV_RAW.trim().split("\n");
  const header = lines[0].split(",");
  _cachedRows = lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h.trim()] = (vals[i] ?? "").trim()));
    return row as unknown as CsvRow;
  });
  return _cachedRows;
}

// ---------------------------------------------------------------------------
// Obando polygons (same as Python backend)
// ---------------------------------------------------------------------------

interface PolyDef {
  threshold?: number;
  type: string;
  zone: string | null;
  label: string;
  coords: number[][];
}

const PERMANENT_WATER: PolyDef[] = [
  {
    type: "water", zone: null, label: "Obando River",
    coords: [
      [120.932, 14.712], [120.9325, 14.7122], [120.936, 14.71],
      [120.9365, 14.7095], [120.936, 14.7092], [120.9325, 14.7115],
    ],
  },
  {
    type: "water", zone: null, label: "Fishpond",
    coords: [
      [120.938, 14.707], [120.939, 14.707],
      [120.939, 14.7062], [120.938, 14.7062],
    ],
  },
];

const FLOOD_ZONES: PolyDef[] = [
  { threshold: 0.03, type: "flood", zone: "C", label: "Rice paddies east (early flood)",
    coords: [[120.938, 14.704], [120.941, 14.704], [120.941, 14.702], [120.938, 14.702]] },
  { threshold: 0.03, type: "flood", zone: "C", label: "Low road near Sta. Cruz",
    coords: [[120.934, 14.705], [120.936, 14.705], [120.936, 14.7042], [120.934, 14.7042]] },
  { threshold: 0.05, type: "flood", zone: null, label: "Fishpond overflow",
    coords: [[120.9375, 14.7075], [120.9395, 14.7075], [120.9395, 14.7058], [120.9375, 14.7058]] },
  { threshold: 0.08, type: "flood", zone: "B", label: "Tawiran-Paco residential flooding",
    coords: [[120.934, 14.708], [120.938, 14.708], [120.938, 14.7055], [120.934, 14.7055]] },
  { threshold: 0.08, type: "flood", zone: "B", label: "Barangay hall area flooding",
    coords: [[120.9295, 14.708], [120.9335, 14.708], [120.9335, 14.706], [120.9295, 14.706]] },
  { threshold: 0.12, type: "flood", zone: "A", label: "Obando River overflow (dike breach area)",
    coords: [[120.931, 14.713], [120.934, 14.7135], [120.937, 14.711], [120.938, 14.7095], [120.9375, 14.708], [120.934, 14.7085], [120.9315, 14.711]] },
  { threshold: 0.12, type: "flood", zone: "A", label: "Dike frontage — critical water level",
    coords: [[120.934, 14.7115], [120.938, 14.7115], [120.938, 14.7095], [120.934, 14.7095]] },
  { threshold: 0.15, type: "flood", zone: "C", label: "Rice fields — total inundation",
    coords: [[120.937, 14.705], [120.942, 14.705], [120.942, 14.701], [120.937, 14.701]] },
  { threshold: 0.15, type: "flood", zone: "C", label: "Southern agricultural area",
    coords: [[120.932, 14.704], [120.937, 14.704], [120.937, 14.7015], [120.932, 14.7015]] },
];

function closeRing(coords: number[][]): number[][] {
  const ring = coords.map((c) => [...c]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([...ring[0]]);
  }
  return ring;
}

function classifyStatus(floodExtent: number): "normal" | "warning" | "critical" {
  if (floodExtent >= 0.1) return "critical";
  if (floodExtent >= 0.05) return "warning";
  return "normal";
}

function computeFloodAreaHa(floodExtent: number): number {
  return Math.round(floodExtent * 280 * 10) / 10;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getAllFloodExtents() {
  const rows = readCsvRows();
  const byDate: Record<string, CsvRow> = {};
  for (const row of rows) {
    const dateKey = (row.timestamp || "").slice(0, 10);
    byDate[dateKey] = row;
  }

  return Object.keys(byDate)
    .sort()
    .map((dateKey) => {
      const row = byDate[dateKey];
      const fe = parseFloat(row.flood_extent) || 0;
      const ss = parseFloat(row.soil_saturation) || 0;
      const wt = parseInt(row.wetness_trend) || 0;
      return {
        id: `S1_GEE_${dateKey.replace(/-/g, "")}`,
        date: row.timestamp,
        status: classifyStatus(fe),
        floodAreaHa: computeFloodAreaHa(fe),
        floodExtent: fe,
        soilSaturation: ss,
        wetnessTrend: wt,
        source: "gee-csv",
      };
    });
}

export function getFloodExtentGeoJSON(timestamp?: string | null) {
  const rows = readCsvRows();
  if (!rows.length) return null;

  let row: CsvRow | undefined;
  if (timestamp) {
    // Extract date from scene ID like S1_GEE_20260220
    let target = timestamp;
    if (target.startsWith("S1_GEE_") && target.length >= 15) {
      const d = target.slice(7);
      target = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }
    row = rows.find((r) => (r.timestamp || "").startsWith(target.slice(0, 10)));
  }
  if (!row) row = rows[rows.length - 1];

  const fe = parseFloat(row.flood_extent) || 0;
  const ss = parseFloat(row.soil_saturation) || 0;
  const wt = parseInt(row.wetness_trend) || 0;
  const ts = row.timestamp || "";
  const status = classifyStatus(fe);

  const features: Record<string, unknown>[] = [];

  // Permanent water
  for (const pw of PERMANENT_WATER) {
    features.push({
      type: "Feature",
      properties: { type: pw.type, zone: pw.zone, label: pw.label, confidence: 0.95 },
      geometry: { type: "Polygon", coordinates: [closeRing(pw.coords)] },
    });
  }

  // Flood zones based on threshold
  for (const fz of FLOOD_ZONES) {
    if (fe >= (fz.threshold ?? 0)) {
      const confidence = Math.min(0.96, 0.7 + (fe - (fz.threshold ?? 0)) * 3);
      features.push({
        type: "Feature",
        properties: {
          type: fz.type, zone: fz.zone, label: fz.label,
          confidence: Math.round(confidence * 100) / 100,
        },
        geometry: { type: "Polygon", coordinates: [closeRing(fz.coords)] },
      });
    }
  }

  const floodArea = computeFloodAreaHa(fe);
  const floodCount = features.filter(
    (f) => (f.properties as Record<string, unknown>).type === "flood"
  ).length;

  let description: string;
  if (status === "critical") description = "Critical — widespread flooding across Zones A, B, C";
  else if (status === "warning") description = "Warning — low-lying fields and roads beginning to flood";
  else description = "Normal — rivers and ponds within expected levels";
  description += `. Soil saturation: ${Math.round(ss * 100)}%`;

  const datePart = ts.slice(0, 10).replace(/-/g, "") || "unknown";

  return {
    id: `S1_GEE_${datePart}`,
    date: ts,
    status,
    description,
    floodAreaHa: floodArea,
    polygonCount: floodCount,
    source: "gee-csv",
    soilSaturation: ss,
    floodExtent: fe,
    wetnessTrend: wt,
    geojson: { type: "FeatureCollection", features },
  };
}
