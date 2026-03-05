# =============================================================================
# RapidRelay – Sentinel / EO Service
#
# Manages Earth Observation features — currently mock, scaffolded for real
# Sentinel-1 SAR processing in Phase 2.
#
# Phase 1 (now):
#   - Reads existing eo_features.csv from the prototype data dir
#   - Falls back to random generation if CSV unavailable
#   - Searches STAC catalog for Sentinel-1 metadata (no download)
#
# Phase 2 (future):
#   - Download GRD .zip from Copernicus / Element84
#   - SNAP GPT batch processing
#   - GeoTIFF generation → COG tiles
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
_EO_CSV = _PROTOTYPE_DIR / "data" / "sentinel1" / "eo_features.csv"
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
