# =============================================================================
# RapidRelay – Sensor Service
#
# Queries real sensor data from Supabase obando_environmental_data table.
# Calculates water_level from ultrasonic distance_m measurements:
#   water_level [m] = dike_height [m] - distance_m [m]
# Dike height: 13'3" = 4.038 meters
# =============================================================================

from datetime import datetime, timezone, timedelta
from typing import Optional

from app.models.schemas import SensorReading, SensorSnapshot
from app.supabase_client import get_supabase

# ---------------------------------------------------------------------------
# Water Level Calculation Constants
# ---------------------------------------------------------------------------
DIKE_HEIGHT_M = 4.038  # 13'3" = 4.038 meters (Obando dike reference)

THRESHOLDS = {
    "water_level": {"warning": 1.5, "critical": 2.5},
    "soil_moisture": {"warning": 60, "critical": 80},
    "humidity": {"warning": 75, "critical": 90},
    "rainfall": {"warning": 7.5, "critical": 30},
}


def _status(value: Optional[float], sensor_type: str) -> str:
    """Compute status based on sensor value and thresholds."""
    if value is None:
        return "normal"

    th = THRESHOLDS.get(sensor_type, {})
    if value >= th.get("critical", float("inf")):
        return "critical"
    if value >= th.get("warning", float("inf")):
        return "warning"
    return "normal"


async def get_latest_sensor_reading(sensor_id: str) -> Optional[dict]:
    """Fetch latest reading from obando_environmental_data.

    Calculates water_level from distance_m.
    """
    sb = get_supabase()
    if not sb:
        return None

    try:
        # For now, fetch the latest reading (obando_environmental_data doesn't have sensor_id)
        # If sensor_id is needed, we'd need to add that field to the table
        response = sb.table("obando_environmental_data") \
            .select("*") \
            .order("timestamp", desc=True) \
            .limit(1) \
            .execute()

        if not response.data:
            return None

        reading = response.data[0]

        # Calculate water level
        distance_m = reading.get("distance_m")
        water_level = max(0, DIKE_HEIGHT_M - distance_m) if distance_m is not None else 0.0

        return {
            "sensor_id": sensor_id,
            "water_level": water_level,
            "soil_moisture": reading.get("soil"),
            "humidity": reading.get("humidity"),
            "temperature": reading.get("temperature"),
            "pressure": reading.get("pressure"),
            "distance_m": distance_m,
            "timestamp": reading.get("timestamp"),
        }
    except Exception as e:
        print(f"[SensorService] Error fetching reading for {sensor_id}: {e}")
        return None


async def get_latest_snapshot() -> Optional[SensorSnapshot]:
    """Fetch the latest sensor snapshot aggregated from all nodes.

    Queries real data from obando_environmental_data table.
    Calculates water_level from distance_m: water_level = dike_height - distance_m
    Syncs calculated water_level to Supabase sensor_readings table.
    """
    sb = get_supabase()
    if not sb:
        return None

    try:
        # Fetch latest reading from obando_environmental_data (most recent timestamp)
        response = sb.table("obando_environmental_data") \
            .select("*") \
            .order("timestamp", desc=True) \
            .limit(1) \
            .execute()

        if not response.data or len(response.data) == 0:
            return None

        reading = response.data[0]
        ts = datetime.fromisoformat(reading["timestamp"].replace("Z", "+00:00"))

        # Calculate water level from distance_m (ultrasonic sensor)
        # water_level = dike_height - distance_to_water
        distance_m = reading.get("distance_m")
        if distance_m is not None and distance_m >= 0:
            water_level = max(0, DIKE_HEIGHT_M - distance_m)
        else:
            water_level = 0.0

        # Get other measurements
        soil_moisture = reading.get("soil", 0.0)  # Column name is "soil" not soil_moisture
        humidity = reading.get("humidity", 0.0)
        temperature = reading.get("temperature", 0.0)
        pressure = reading.get("pressure", 0.0)
        rainfall = 0.0  # Not in obando_environmental_data, use 0

        # Sync to sensor_readings table (persist calculated water_level)
        try:
            sb.table("sensor_readings").insert({
                "sensor_id": "node-obando-gateway",
                "water_level": water_level,
                "rainfall": rainfall,
                "humidity": humidity,
                "soil_moisture": soil_moisture,
                "temperature": temperature,
                "pressure": pressure,
                "latitude": 14.707225,  # PAGASA Obando Station
                "longitude": 120.937613,
                "is_valid": True,
                "timestamp": ts.isoformat(),
            }).execute()
        except Exception as e:
            print(f"[SensorService] Warning: Could not sync to sensor_readings: {e}")

        # Compute risk score
        water_score = min(water_level / 3.0, 1.0)
        rain_score = min(rainfall / 50.0, 1.0)
        hum_score = min(humidity / 100.0, 1.0)
        soil_score = min(soil_moisture / 100.0, 1.0)

        risk = round(
            0.3 * water_score +
            0.3 * rain_score +
            0.2 * hum_score +
            0.2 * soil_score,
            4
        )

        overall = "critical" if risk > 0.8 else "warning" if risk > 0.5 else "normal"

        def mk_reading(val: float, sensor_type: str) -> SensorReading:
            return SensorReading(
                sensor_id=sensor_type,
                value=val,
                effective_value=val,
                is_valid=True,
                status=_status(val, sensor_type),
                timestamp=ts,
            )

        return SensorSnapshot(
            water_level=mk_reading(water_level, "water_level"),
            soil_moisture=mk_reading(soil_moisture, "soil_moisture"),
            humidity=mk_reading(humidity, "humidity"),
            rainfall=rainfall,
            flood_extent=0.0,  # Deprecated — use Sentinel-1 EO
            wetness_trend=0,   # Deprecated — use EO trends
            risk=risk,
            overall_status=overall,
            timestamp=ts,
        )
    except Exception as e:
        print(f"[SensorService] Error fetching snapshot: {e}")
        return None


async def get_sensor_history(
    sensor_id: Optional[str] = None,
    limit: int = 100,
    hours: int = 24,
) -> list[dict]:
    """Fetch historical sensor readings from obando_environmental_data.

    Calculates water_level from distance_m for each record.

    Args:
        sensor_id: Ignored (obando_environmental_data is single-sensor)
        limit: Maximum readings to return
        hours: Lookback window in hours
    """
    sb = get_supabase()
    if not sb:
        return []

    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

        response = sb.table("obando_environmental_data") \
            .select("*") \
            .gte("timestamp", cutoff) \
            .order("timestamp", desc=True) \
            .limit(limit) \
            .execute()

        if not response.data:
            return []

        # Transform: calculate water_level from distance_m
        results = []
        for row in response.data:
            distance_m = row.get("distance_m")
            water_level = max(0, DIKE_HEIGHT_M - distance_m) if distance_m is not None else 0.0

            results.append({
                "id": row.get("id"),
                "timestamp": row.get("timestamp"),
                "water_level": water_level,
                "distance_m": distance_m,
                "soil_moisture": row.get("soil"),
                "humidity": row.get("humidity"),
                "temperature": row.get("temperature"),
                "pressure": row.get("pressure"),
            })

        return results
    except Exception as e:
        print(f"[SensorService] Error fetching history: {e}")
        return []


async def sync_obando_to_sensor_readings(hours: int = 24) -> int:
    """Sync calculated water levels from obando_environmental_data to sensor_readings.

    Backfills sensor_readings table with calculated water_level values.
    Deduplicates by timestamp to avoid duplicates.

    Args:
        hours: How far back to sync (default 24 hours)

    Returns:
        Number of records synced
    """
    sb = get_supabase()
    if not sb:
        return 0

    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

        # Fetch all records from obando_environmental_data in the timeframe
        response = sb.table("obando_environmental_data") \
            .select("*") \
            .gte("timestamp", cutoff) \
            .order("timestamp", desc=False) \
            .execute()

        if not response.data:
            return 0

        # Build insert rows with calculated water_level
        rows = []
        for row in response.data:
            distance_m = row.get("distance_m")
            water_level = max(0, DIKE_HEIGHT_M - distance_m) if distance_m is not None else 0.0

            rows.append({
                "sensor_id": "node-obando-gateway",
                "water_level": water_level,
                "rainfall": 0.0,
                "humidity": row.get("humidity", 0.0),
                "soil_moisture": row.get("soil", 0.0),
                "temperature": row.get("temperature", 0.0),
                "pressure": row.get("pressure", 0.0),
                "latitude": 14.707225,
                "longitude": 120.937613,
                "is_valid": True,
                "timestamp": row.get("timestamp"),
            })

        # Bulk insert with conflict handling
        if rows:
            sb.table("sensor_readings").upsert(rows).execute()
            print(f"[SensorService] Synced {len(rows)} records from obando_environmental_data")
            return len(rows)

        return 0
    except Exception as e:
        print(f"[SensorService] Error syncing to sensor_readings: {e}")
        return 0
