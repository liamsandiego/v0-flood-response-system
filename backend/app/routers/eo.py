# =============================================================================
# RapidRelay – Earth Observation Router
# =============================================================================

from fastapi import APIRouter, Query
from typing import List, Optional

from app.services.sentinel_service import (
    get_latest_eo_features,
    get_eo_history,
    list_sentinel_catalog,
    search_stac_catalog,
    get_flood_extent_geojson,
    get_all_flood_extents,
)
from app.models.schemas import EOFeatures, SentinelCatalogItem

router = APIRouter()


@router.get("/features", response_model=EOFeatures)
async def get_eo_features():
    """Return the latest EO-derived features (soil saturation, flood extent, wetness trend).

    Phase 1: reads from prototype CSV or generates mock.
    Phase 2: derived from processed Sentinel-1 GRD.
    """
    return get_latest_eo_features()


@router.get("/features/history", response_model=List[EOFeatures])
async def get_eo_features_history(
    limit: int = Query(default=50, le=500),
):
    """Return recent EO feature rows."""
    return get_eo_history(limit)


@router.get("/sentinel/flood-extent")
async def get_sentinel_flood_extent(
    timestamp: Optional[str] = Query(
        default=None,
        description="Scene ID (e.g. S1_GEE_20260220) or date (YYYY-MM-DD). "
                    "Returns closest match. Omit for latest.",
    ),
):
    """Return GeoJSON flood extent polygons derived from real GEE Sentinel-1 data.

    Uses the soil_saturation and flood_extent values from the 9-year GEE
    timeseries CSV to generate spatially accurate flood polygons for Obando.
    """
    result = get_flood_extent_geojson(timestamp)
    if not result:
        return {"error": "No GEE Sentinel-1 data available", "source": "none"}
    return result


@router.get("/sentinel/flood-extents")
async def list_sentinel_flood_extents():
    """List all available flood extent records from GEE CSV (no GeoJSON, just metadata).

    Use this to populate the date picker in the frontend.
    """
    return get_all_flood_extents()


@router.get("/sentinel/catalog", response_model=List[SentinelCatalogItem])
async def get_sentinel_catalog():
    """List Sentinel-1 metadata files available locally."""
    return list_sentinel_catalog()


@router.get("/sentinel/search", response_model=List[SentinelCatalogItem])
async def search_sentinel(
    days: float = Query(default=7, description="How many days back to search"),
    max_items: int = Query(default=5, le=20),
):
    """Search the STAC catalog for recent Sentinel-1 GRD products.

    Only fetches metadata — no large SAR downloads. Requires pystac-client.
    """
    return search_stac_catalog(days=days, max_items=max_items)
