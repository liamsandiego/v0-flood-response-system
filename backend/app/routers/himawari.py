# =============================================================================
# RapidRelay – Himawari Router
# =============================================================================

from fastapi import APIRouter
from typing import List

from app.services.himawari_service import (
    get_capabilities,
    get_available_times,
    get_best_available_time,
    get_products,
)
from app.models.schemas import HimawariCapabilities

router = APIRouter()


@router.get("/capabilities", response_model=HimawariCapabilities)
async def himawari_capabilities():
    """Describe available Himawari products via NASA GIBS.

    The frontend calls the GIBS WMS endpoint directly (free, CORS-enabled).
    This endpoint only provides metadata for the UI to configure the layer.
    """
    return get_capabilities()


@router.get("/times", response_model=List[str])
async def himawari_available_times(hours_back: int = 48):
    """Return date strings (YYYY-MM-DD) for the GIBS TIME dimension."""
    return get_available_times(hours_back)


@router.get("/best-time")
async def himawari_best_time():
    """Return the single best-available date string for Himawari data."""
    return {"time": get_best_available_time()}


@router.get("/products")
async def himawari_products():
    """Return product metadata for UI dropdowns."""
    return get_products()
