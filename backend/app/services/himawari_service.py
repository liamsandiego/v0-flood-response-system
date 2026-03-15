# =============================================================================
# RapidRelay – Himawari Service
#
# Provides metadata about NASA GIBS Himawari satellite products.
#
# The frontend calls the GIBS WMS endpoint DIRECTLY (no proxy needed for
# tile requests — GIBS has generous CORS headers). This service only:
#   1. Describes available products / parameters
#   2. Computes the best available time window (accounting for 3–5 h delay)
#   3. Could proxy WMS GetCapabilities XML in the future
#
# Why no proxy for tiles?
#   NASA GIBS is completely free with no API key. It supports CORS, so the
#   browser can fetch tiles directly. Proxying would add latency and load
#   to our backend for no benefit.
# =============================================================================

from datetime import datetime, timezone, timedelta
from typing import List

from app.models.schemas import HimawariCapabilities


# GIBS WMS base URL (EPSG:3857 projection for web maps)
GIBS_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"

# Available Himawari products on GIBS
HIMAWARI_PRODUCTS = [
    {
        "id": "Himawari_AHI_Band13_Clean_Infrared",
        "label": "Clean Infrared (Band 13)",
        "description": "10.4 µm infrared — works day and night. Shows cloud-top temperature.",
        "day_night": "both",
        "tile_matrix_set": "GoogleMapsCompatible_Level6",
        "max_zoom": 6,
    },
    {
        "id": "Himawari_AHI_Band3_Red_Visible_1km",
        "label": "Red Visible (Band 3, 1km)",
        "description": "0.64 µm visible — daytime only. True-color-like imagery.",
        "day_night": "day_only",
        "tile_matrix_set": "GoogleMapsCompatible_Level7",
        "max_zoom": 7,
    },
]


def get_capabilities() -> HimawariCapabilities:
    """Return a description of available Himawari products via NASA GIBS."""
    return HimawariCapabilities()


def get_available_times(hours_back: int = 48) -> List[str]:
    """Return a list of available date strings for the GIBS TIME dimension.

    GIBS resolves Himawari dates to the best available composite.
    The most recent reliable data is typically 3–5 hours old.
    We return dates (YYYY-MM-DD) for the requested window."""
    now = datetime.now(timezone.utc)
    dates = set()
    for h in range(4, hours_back + 1):  # start at 4h delay
        dt = now - timedelta(hours=h)
        dates.add(dt.strftime("%Y-%m-%d"))
    return sorted(dates, reverse=True)


def get_best_available_time() -> str:
    """Return the most recent date string likely to have Himawari data."""
    best = datetime.now(timezone.utc) - timedelta(hours=4)
    return best.strftime("%Y-%m-%d")


def get_products() -> List[dict]:
    """Return product metadata for the frontend to populate dropdowns."""
    return HIMAWARI_PRODUCTS
