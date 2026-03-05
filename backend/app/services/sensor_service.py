# =============================================================================
# RapidRelay – Sensor Service
#
# Generates / polls sensor data. Currently uses the same mock-data logic
# from Rapid-Relay-Pre-Prototype-main/scripts/generate_mock_data.py.
#
# Migration path:
#   Phase 1 (now)  → random generation (this file)
#   Phase 2        → poll real LoRaWAN / MQTT endpoints
# =============================================================================

import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.models.schemas import SensorReading, SensorSnapshot

# ---------------------------------------------------------------------------
# Thresholds (mirrored from frontend constants)
# ---------------------------------------------------------------------------
THRESHOLDS = {
    "ultrasonic_water_level": {"warning": 1.5, "critical": 2.5},
    "capacitive_soil_moisture": {"warning": 60, "critical": 80},
    "humidity_dht22": {"warning": 75, "critical": 90},
    "rain_gauge": {"warning": 7.5, "critical": 30},
}


def _status(value: float, sensor_id: str) -> str:
    th = THRESHOLDS.get(sensor_id, {})
    if value >= th.get("critical", float("inf")):
        return "critical"
    if value >= th.get("warning", float("inf")):
        return "warning"
    return "normal"


def generate_sensor_reading(
    sensor_id: str,
    value: Optional[float] = None,
) -> SensorReading:
    """Create a single reading. If `value` is None, generate a random one."""
    if value is None:
        if sensor_id == "ultrasonic_water_level":
            value = random.uniform(0.2, 3.5)  # metres
        elif sensor_id == "capacitive_soil_moisture":
            value = random.uniform(20, 95)  # %
        elif sensor_id == "humidity_dht22":
            value = random.uniform(50, 98)  # %
        else:
            value = 0.0

    return SensorReading(
        sensor_id=sensor_id,
        value=value,
        effective_value=value,
        is_valid=True,
        status=_status(value, sensor_id),
        timestamp=datetime.now(timezone.utc),
    )


def generate_snapshot() -> SensorSnapshot:
    """Generate a complete sensor snapshot with mock data.

    Merges sensor readings with mock EO features and computes a composite
    risk score identical to Rapid-Relay-Pre-Prototype-main/models/predictor.py.
    """
    water = generate_sensor_reading("ultrasonic_water_level")
    soil = generate_sensor_reading("capacitive_soil_moisture")
    humidity = generate_sensor_reading("humidity_dht22")
    rainfall = round(random.uniform(0, 40), 1)

    # Mock EO features (same ranges as generate_mock_data.py)
    soil_saturation = round(random.uniform(0.6, 0.9), 2)
    flood_extent = round(random.uniform(0.0, 0.4), 2)
    wetness_trend = random.choice([-1, 0, 1])

    # Risk computation (ported from predictor.py)
    water_score = min(water.effective_value / 3.0, 1.0)
    rain_score = min(rainfall / 50.0, 1.0)
    hum_score = min(humidity.effective_value / 100.0, 1.0)
    sensor_index = 0.4 * rain_score + 0.3 * hum_score + 0.3 * water_score

    soil_score = min(soil_saturation / 1.0, 1.0)
    flood_score = min(flood_extent / 0.5, 1.0)
    trend_map = {-1: 0.0, 0: 0.5, 1: 1.0}
    trend_score = trend_map.get(wetness_trend, 0.5)
    eo_index = 0.4 * soil_score + 0.3 * flood_score + 0.3 * trend_score

    risk = round(0.5 * sensor_index + 0.5 * eo_index, 4)

    overall = "critical" if risk > 0.8 else "warning" if risk > 0.5 else "normal"
    # Override if any single sensor is critical
    if any(r.status == "critical" for r in [water, soil, humidity]):
        overall = "critical"

    return SensorSnapshot(
        water_level=water,
        soil_moisture=soil,
        humidity=humidity,
        rainfall=rainfall,
        flood_extent=flood_extent,
        wetness_trend=wetness_trend,
        risk=risk,
        overall_status=overall,
        timestamp=datetime.now(timezone.utc),
    )
