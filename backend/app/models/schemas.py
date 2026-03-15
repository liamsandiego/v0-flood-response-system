# =============================================================================
# RapidRelay – Pydantic Models (shared API schemas)
# =============================================================================

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field


class AlertLevel(str, Enum):
    """Matches the frontend AlertLevel type."""
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


class SensorReading(BaseModel):
    """A single timestamped reading from one physical sensor."""
    sensor_id: str
    value: float
    effective_value: float
    is_valid: bool = True
    invalid_reason: Optional[str] = None
    status: str = "normal"  # normal | warning | critical
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class SensorSnapshot(BaseModel):
    """Aggregated snapshot of all sensors at one point in time."""
    water_level: SensorReading
    soil_moisture: SensorReading
    humidity: SensorReading
    rainfall: float = 0.0
    flood_extent: float = 0.0
    wetness_trend: int = 0
    risk: float = 0.0
    overall_status: str = "normal"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class EOFeatures(BaseModel):
    """Earth-observation derived features (currently mock, future: real SAR)."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    soil_saturation: Optional[float] = None
    flood_extent: Optional[float] = None
    wetness_trend: Optional[int] = None
    source: str = "mock"  # "mock" | "sentinel-1" | "himawari"


class AlertTrigger(BaseModel):
    """Manual alert broadcast request from the frontend."""
    message: str
    level: AlertLevel = AlertLevel.YELLOW
    channels: List[str] = Field(default_factory=lambda: ["sms", "speaker", "social"])


class AlertResponse(BaseModel):
    """Response after triggering an alert."""
    success: bool
    alert_id: str
    message: str
    channels_sent: List[str]
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class SentinelCatalogItem(BaseModel):
    """Metadata about one Sentinel-1 product."""
    product_id: str
    datetime: Optional[str] = None
    collection: str = "sentinel-1-grd"
    has_eo_features: bool = False


class HimawariCapabilities(BaseModel):
    """Describes what Himawari products / times are available via NASA GIBS."""
    products: List[str] = Field(
        default_factory=lambda: [
            "Himawari_AHI_Band13_Clean_Infrared",
            "Himawari_AHI_Band3_Red_Visible_1km",
        ]
    )
    wms_endpoint: str = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
    max_zoom: int = 7
    typical_delay_hours: float = 4.0
    coverage: str = "East Asia / West Pacific (includes Philippines)"
    note: str = (
        "Completely free — no API key required. "
        "TIME parameter format: YYYY-MM-DD. "
        "The frontend should call the WMS endpoint directly; "
        "this endpoint only describes available parameters."
    )
