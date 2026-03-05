# =============================================================================
# RapidRelay – Earth Observation Router
# =============================================================================

from fastapi import APIRouter, Query
from typing import List

from app.services.sentinel_service import (
    get_latest_eo_features,
    get_eo_history,
    list_sentinel_catalog,
    search_stac_catalog,
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
