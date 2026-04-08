# =============================================================================
# RapidRelay – Sensors Router
#
# Serves real sensor data from Supabase sensor_readings table.
# No longer uses mock data — powered by sensor_status view.
# =============================================================================

from fastapi import APIRouter, Query
from typing import Optional

from app.services.sensor_service import (
    get_latest_snapshot,
    get_latest_sensor_reading,
    get_sensor_history,
    sync_obando_to_sensor_readings,
)
from app.models.schemas import SensorSnapshot

router = APIRouter()


@router.get("/latest", response_model=SensorSnapshot)
async def get_latest_sensors():
    """Return the latest sensor snapshot from Supabase."""
    snapshot = await get_latest_snapshot()
    if snapshot is None:
        raise Exception("No sensor data available")
    return snapshot


@router.get("/reading/{sensor_id}")
async def get_sensor_reading(sensor_id: str):
    """Return the latest reading for one sensor."""
    reading = await get_latest_sensor_reading(sensor_id)
    if reading is None:
        raise Exception(f"No data for sensor {sensor_id}")
    return reading


@router.get("/history")
async def get_sensor_history_route(
    sensor_id: Optional[str] = Query(default=None, description="Filter by sensor ID"),
    limit: int = Query(default=100, le=1000, description="Number of readings"),
    hours: int = Query(default=24, le=168, description="Lookback window in hours"),
):
    """Return historical sensor readings from Supabase."""
    return await get_sensor_history(
        sensor_id=sensor_id,
        limit=limit,
        hours=hours,
    )


@router.get("/nodes")
async def get_sensor_nodes():
    """Get all sensor node metadata from sensor_data table."""
    from app.supabase_client import get_supabase

    sb = get_supabase()
    if not sb:
        return {"type": "FeatureCollection", "features": []}

    try:
        response = sb.table("sensor_data").select("sensor_id,name,latitude,longitude").execute()
        features = []
        for node in response.data or []:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [node["longitude"], node["latitude"]],
                },
                "properties": {
                    "sensor_id": node["sensor_id"],
                    "name": node["name"],
                },
            })
        return {"type": "FeatureCollection", "features": features}
    except Exception as e:
        print(f"[Sensors] Error fetching nodes: {e}")
        return {"type": "FeatureCollection", "features": []}


@router.get("/status")
async def get_sensor_status():
    """Get current sensor status aggregate (real-time)."""
    from app.supabase_client import get_supabase

    sb = get_supabase()
    if not sb:
        return {"online": 0, "offline": 0, "status": "unknown"}

    try:
        response = sb.rpc("get_sensor_status_aggregate").execute()
        return response.data or {"online": 0, "offline": 0}
    except Exception:
        pass

    # Fallback: count active sensor_data entries
    try:
        response = sb.table("sensor_data").select("count", count="exact").execute()
        return {"active_sensors": response.count, "last_updated": None}
    except Exception as e:
        print(f"[Sensors] Error getting status: {e}")
        return {"status": "error"}


@router.post("/sync")
async def sync_obando_data(hours: int = Query(24, description="Hours of data to sync")):
    """Manually sync obando_environmental_data to sensor_readings table.

    Calculates water_level from distance_m and stores in sensor_readings.
    """
    synced = await sync_obando_to_sensor_readings(hours=hours)
    return {"status": "synced", "records": synced, "hours": hours}
