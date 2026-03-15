# =============================================================================
# RapidRelay – Sentinel / EO Service
#
# Manages Earth Observation features derived from Sentinel-1 SAR processing
# via Google Earth Engine (GEE).
#
# Data source:
#   - Reads sentinel1_timeseries.csv from GEE-Processing dir (~9 years of
#     real Sentinel-1 derived soil saturation, flood extent, wetness trend)
#   - Falls back to random generation if CSV unavailable
#   - Searches STAC catalog for Sentinel-1 metadata (no download)
# =============================================================================

import csv
import random
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from app.models.schemas import EOFeatures, SentinelCatalogItem

# Path to Rapid-Relay-Pre-Prototype-main data (if running from workspace root)
_PROJECT_ROOT = Path(__file__).resolve().parents[2]  # backend/
_PROTOTYPE_DIR = _PROJECT_ROOT.parent / "Rapid-Relay-Pre-Prototype-main" / "flood_preprototype"
_EO_CSV = _PROTOTYPE_DIR / "data" / "sentinel1" / "GEE-Processing" / "sentinel1_timeseries.csv"
_SENTINEL_DIR = _PROTOTYPE_DIR / "data" / "sentinel1"


def get_latest_eo_features() -> EOFeatures:
    """Return the most recent EO features from the prototype CSV,
    or generate mock values if the CSV doesn't exist."""
    if _EO_CSV.exists():
        try:
            with _EO_CSV.open("r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            if rows:
                last = rows[-1]
                return EOFeatures(
                    timestamp=last.get("timestamp", datetime.now(timezone.utc).isoformat()),
                    soil_saturation=_try_float(last.get("soil_saturation")),
                    flood_extent=_try_float(last.get("flood_extent")),
                    wetness_trend=_try_int(last.get("wetness_trend")),
                    source="csv",
                )
        except Exception:
            pass

    # Fallback: generate mock
    return EOFeatures(
        soil_saturation=round(random.uniform(0.6, 0.9), 2),
        flood_extent=round(random.uniform(0.0, 0.4), 2),
        wetness_trend=random.choice([-1, 0, 1]),
        source="mock",
    )


def get_eo_history(limit: int = 50) -> List[EOFeatures]:
    """Return recent EO feature rows."""
    results: List[EOFeatures] = []
    if _EO_CSV.exists():
        try:
            with _EO_CSV.open("r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            for row in rows[-limit:]:
                results.append(EOFeatures(
                    timestamp=row.get("timestamp", ""),
                    soil_saturation=_try_float(row.get("soil_saturation")),
                    flood_extent=_try_float(row.get("flood_extent")),
                    wetness_trend=_try_int(row.get("wetness_trend")),
                    source="csv",
                ))
        except Exception:
            pass
    return results


def list_sentinel_catalog() -> List[SentinelCatalogItem]:
    """List Sentinel-1 metadata files found in the prototype data dir."""
    items: List[SentinelCatalogItem] = []
    if _SENTINEL_DIR.exists():
        for f in sorted(_SENTINEL_DIR.glob("S1*.txt")):
            # Parse the txt content for datetime
            dt = None
            try:
                content = f.read_text(encoding="utf-8")
                for line in content.splitlines():
                    if line.startswith("Datetime:"):
                        dt = line.split(":", 1)[1].strip()
            except Exception:
                pass
            items.append(SentinelCatalogItem(
                product_id=f.stem,
                datetime=dt,
            ))
    return items


def search_stac_catalog(
    days: float = 7,
    max_items: int = 5,
) -> List[SentinelCatalogItem]:
    """Query the Element84 STAC catalog for recent Sentinel-1 GRD products.
    This only fetches metadata — no large downloads.

    Requires pystac-client (already in prototype requirements.txt).
    Falls back gracefully if the library isn't installed."""
    try:
        from pystac_client import Client as StacClient

        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)

        catalog = StacClient.open("https://earth-search.aws.element84.com/v1")
        search = catalog.search(
            collections=["sentinel-1-grd"],
            datetime=f"{start.isoformat()}Z/{end.isoformat()}Z",
            limit=max_items,
        )

        results = []
        for item in search.items():
            results.append(SentinelCatalogItem(
                product_id=item.id,
                datetime=str(item.datetime) if item.datetime else None,
            ))
        return results

    except ImportError:
        return []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Flood extent GeoJSON generation from real GEE data
# ---------------------------------------------------------------------------

# Obando, Bulacan reference polygons — realistic geographic features
# scaled by flood_extent value from the GEE timeseries CSV.
# Coordinates are real Obando locations around PAGASA station (14.7072, 120.9376)

_PERMANENT_WATER = [
    # Obando River — always present
    {
        "type": "water", "zone": None, "label": "Obando River",
        "coords": [
            [120.9320, 14.7120], [120.9325, 14.7122], [120.9360, 14.7100],
            [120.9365, 14.7095], [120.9360, 14.7092], [120.9325, 14.7115],
        ],
    },
    # Fishpond near dike — always present
    {
        "type": "water", "zone": None, "label": "Fishpond",
        "coords": [
            [120.9380, 14.7070], [120.9390, 14.7070],
            [120.9390, 14.7062], [120.9380, 14.7062],
        ],
    },
]

# Flood polygons activated at increasing flood_extent thresholds
_FLOOD_ZONES = [
    # threshold 0.03 — Zone C agricultural (first to flood)
    {
        "threshold": 0.03, "type": "flood", "zone": "C",
        "label": "Rice paddies east (early flood)",
        "coords": [
            [120.9380, 14.7040], [120.9410, 14.7040],
            [120.9410, 14.7020], [120.9380, 14.7020],
        ],
    },
    {
        "threshold": 0.03, "type": "flood", "zone": "C",
        "label": "Low road near Sta. Cruz",
        "coords": [
            [120.9340, 14.7050], [120.9360, 14.7050],
            [120.9360, 14.7042], [120.9340, 14.7042],
        ],
    },
    # threshold 0.05 — fishpond overflow + river swelling
    {
        "threshold": 0.05, "type": "flood", "zone": None,
        "label": "Fishpond overflow",
        "coords": [
            [120.9375, 14.7075], [120.9395, 14.7075],
            [120.9395, 14.7058], [120.9375, 14.7058],
        ],
    },
    # threshold 0.08 — Zone B residential
    {
        "threshold": 0.08, "type": "flood", "zone": "B",
        "label": "Tawiran-Paco residential flooding",
        "coords": [
            [120.9340, 14.7080], [120.9380, 14.7080],
            [120.9380, 14.7055], [120.9340, 14.7055],
        ],
    },
    {
        "threshold": 0.08, "type": "flood", "zone": "B",
        "label": "Barangay hall area flooding",
        "coords": [
            [120.9295, 14.7080], [120.9335, 14.7080],
            [120.9335, 14.7060], [120.9295, 14.7060],
        ],
    },
    # threshold 0.12 — Zone A dike breach
    {
        "threshold": 0.12, "type": "flood", "zone": "A",
        "label": "Obando River overflow (dike breach area)",
        "coords": [
            [120.9310, 14.7130], [120.9340, 14.7135], [120.9370, 14.7110],
            [120.9380, 14.7095], [120.9375, 14.7080], [120.9340, 14.7085],
            [120.9315, 14.7110],
        ],
    },
    {
        "threshold": 0.12, "type": "flood", "zone": "A",
        "label": "Dike frontage — critical water level",
        "coords": [
            [120.9340, 14.7115], [120.9380, 14.7115],
            [120.9380, 14.7095], [120.9340, 14.7095],
        ],
    },
    # threshold 0.15 — total inundation Zone C
    {
        "threshold": 0.15, "type": "flood", "zone": "C",
        "label": "Rice fields — total inundation",
        "coords": [
            [120.9370, 14.7050], [120.9420, 14.7050],
            [120.9420, 14.7010], [120.9370, 14.7010],
        ],
    },
    {
        "threshold": 0.15, "type": "flood", "zone": "C",
        "label": "Southern agricultural area",
        "coords": [
            [120.9320, 14.7040], [120.9370, 14.7040],
            [120.9370, 14.7015], [120.9320, 14.7015],
        ],
    },
]


def _close_ring(coords: list) -> list:
    """Ensure a polygon ring is closed (first == last coordinate)."""
    ring = [list(c) for c in coords]
    if ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return ring


def _classify_status(flood_extent: float) -> str:
    if flood_extent >= 0.10:
        return "critical"
    if flood_extent >= 0.05:
        return "warning"
    return "normal"


def _compute_flood_area_ha(flood_extent: float) -> float:
    """Rough estimate of flood area in hectares based on flood_extent fraction."""
    # The AOI is ~50km x 78km = 390,000 ha. Obando proper is ~800 ha.
    # Scale to the local Obando area coverage.
    return round(flood_extent * 280, 1)  # 0.12 -> ~33.6 ha


def get_flood_extent_geojson(timestamp: Optional[str] = None) -> Optional[dict]:
    """Generate a GeoJSON flood extent record from real GEE CSV data.

    If timestamp is provided, finds the closest matching row.
    Otherwise uses the latest row.

    Returns a dict matching FloodExtentRecord structure:
    {id, date, status, description, floodAreaHa, polygonCount, source, geojson}
    """
    rows = _read_csv_rows()
    if not rows:
        return None

    row = None
    if timestamp:
        # Find closest row by timestamp
        row = _find_closest_row(rows, timestamp)
    if not row:
        row = rows[-1]

    flood_ext = _try_float(row.get("flood_extent")) or 0.0
    soil_sat = _try_float(row.get("soil_saturation")) or 0.0
    ts = row.get("timestamp", "")
    status = _classify_status(flood_ext)

    # Build GeoJSON features
    features = []

    # Always include permanent water bodies
    for pw in _PERMANENT_WATER:
        features.append({
            "type": "Feature",
            "properties": {
                "type": pw["type"],
                "zone": pw["zone"],
                "label": pw["label"],
                "confidence": 0.95,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [_close_ring(pw["coords"])],
            },
        })

    # Add flood polygons based on flood_extent threshold
    for fz in _FLOOD_ZONES:
        if flood_ext >= fz["threshold"]:
            # Confidence decreases as we get closer to threshold
            confidence = min(0.96, 0.7 + (flood_ext - fz["threshold"]) * 3)
            features.append({
                "type": "Feature",
                "properties": {
                    "type": fz["type"],
                    "zone": fz["zone"],
                    "label": fz["label"],
                    "confidence": round(confidence, 2),
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [_close_ring(fz["coords"])],
                },
            })

    flood_area = _compute_flood_area_ha(flood_ext)
    flood_count = len([f for f in features if f["properties"]["type"] == "flood"])

    # Description based on real values
    desc_parts = []
    if status == "critical":
        desc_parts.append("Critical — widespread flooding across Zones A, B, C")
    elif status == "warning":
        desc_parts.append("Warning — low-lying fields and roads beginning to flood")
    else:
        desc_parts.append("Normal — rivers and ponds within expected levels")
    desc_parts.append(f"Soil saturation: {soil_sat:.0%}")

    # Scene ID from timestamp
    date_part = ts[:10].replace("-", "") if ts else "unknown"
    scene_id = f"S1_GEE_{date_part}"

    return {
        "id": scene_id,
        "date": ts,
        "status": status,
        "description": ". ".join(desc_parts),
        "floodAreaHa": flood_area,
        "polygonCount": flood_count,
        "source": "gee-csv",
        "soilSaturation": soil_sat,
        "floodExtent": flood_ext,
        "wetnessTrend": _try_int(row.get("wetness_trend")),
        "geojson": {
            "type": "FeatureCollection",
            "features": features,
        },
    }


def get_all_flood_extents() -> List[dict]:
    """Return summary of all available flood extent records from the GEE CSV.

    Returns lightweight list (no full GeoJSON) for populating date pickers.
    Deduplicates by date (keeps last row per date, typically later orbit pass).
    """
    rows = _read_csv_rows()
    # Deduplicate: keep last row per date
    by_date: dict = {}
    for row in rows:
        ts = row.get("timestamp", "")
        date_key = ts[:10]
        by_date[date_key] = row

    results = []
    for date_key in sorted(by_date.keys()):
        row = by_date[date_key]
        ts = row.get("timestamp", "")
        flood_ext = _try_float(row.get("flood_extent")) or 0.0
        soil_sat = _try_float(row.get("soil_saturation")) or 0.0
        date_part = date_key.replace("-", "")
        results.append({
            "id": f"S1_GEE_{date_part}",
            "date": ts,
            "status": _classify_status(flood_ext),
            "floodAreaHa": _compute_flood_area_ha(flood_ext),
            "floodExtent": flood_ext,
            "soilSaturation": soil_sat,
            "wetnessTrend": _try_int(row.get("wetness_trend")),
            "source": "gee-csv",
        })
    return results


def _read_csv_rows() -> list:
    """Read and cache the GEE CSV rows."""
    if not _EO_CSV.exists():
        return []
    try:
        with _EO_CSV.open("r", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def _find_closest_row(rows: list, target_ts: str) -> Optional[dict]:
    """Find the CSV row closest to the target timestamp or scene ID."""
    # If it looks like a scene ID (S1_GEE_20260220), extract date
    if target_ts.startswith("S1_GEE_"):
        date_str = target_ts[7:]
        if len(date_str) == 8:
            target_ts = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

    # Try exact date prefix match first
    for row in reversed(rows):
        ts = row.get("timestamp", "")
        if ts.startswith(target_ts[:10]):
            return row

    # Fallback: closest date
    try:
        from datetime import datetime
        target_dt = datetime.fromisoformat(target_ts.replace("Z", "+00:00"))
        best = None
        best_diff = float("inf")
        for row in rows:
            ts = row.get("timestamp", "")
            try:
                row_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                diff = abs((row_dt - target_dt).total_seconds())
                if diff < best_diff:
                    best_diff = diff
                    best = row
            except Exception:
                continue
        return best
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _try_float(x) -> Optional[float]:
    try:
        return float(x)
    except Exception:
        return None


def _try_int(x) -> Optional[int]:
    try:
        return int(float(x))
    except Exception:
        return None
