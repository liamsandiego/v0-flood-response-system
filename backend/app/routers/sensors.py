# =============================================================================
# RapidRelay – Sensors Router
#
# Serves sensor data in GeoJSON format. Uses the IoT simulator in dev mode.
# Real mode: replace simulator with ChirpStack MQTT integration.
# =============================================================================

from fastapi import APIRouter, Query
from typing import List

from app.services.simulator import simulator
from app.services.sensor_service import generate_snapshot, generate_sensor_reading
from app.models.schemas import SensorSnapshot, SensorReading

router = APIRouter()


@router.get("/nodes")
async def get_sensor_nodes():
    """Get all sensor node metadata as static GeoJSON (rarely changes)."""
    features = []
    for node in simulator.nodes:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [node["lon"], node["lat"]],
            },
            "properties": {
                "id": node["id"],
                "name": node["name"],
                "type": node["type"],
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/latest", response_model=SensorSnapshot)
async def get_latest_sensors():
    """Return the latest sensor snapshot (legacy compat — use WebSocket for real-time)."""
    return generate_snapshot()


@router.get("/reading/{sensor_id}", response_model=SensorReading)
async def get_sensor_reading_route(sensor_id: str):
    """Return a single reading for one sensor."""
    return generate_sensor_reading(sensor_id)


@router.get("/realtime")
async def get_realtime():
    """Get current telemetry as GeoJSON FeatureCollection (HTTP polling fallback).

    For real-time updates, connect to WebSocket at /api/ws instead.
    """
    readings = simulator.tick()
    features = []
    for r in readings:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [r["longitude"], r["latitude"]],
            },
            "properties": r,
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/history")
async def get_sensor_history(
    sensor_id: str = Query(default=None, description="Filter by sensor ID"),
    limit: int = Query(default=100, le=1000, description="Number of readings"),
    hours: int = Query(default=24, le=168, description="Lookback window in hours"),
):
    """Return historical sensor readings from Supabase, with mock fallback."""
    from datetime import datetime, timezone, timedelta
    from app.supabase_client import get_supabase

    sb = get_supabase()
    if sb:
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            query = sb.table("sensor_readings").select("*")
            if sensor_id:
                query = query.eq("sensor_id", sensor_id)
            result = query.gte("timestamp", cutoff).order("timestamp", desc=True).limit(limit).execute()
            return result.data
        except Exception:
            pass  # Fall through to mock

    # Fallback: generate mock snapshots
    return [generate_snapshot() for _ in range(min(limit, 20))]


@router.get("/simulator/status")
async def get_simulator_status():
    """Get IoT simulator status (dev mode)."""
    return simulator.get_status()


@router.post("/simulator/flood")
async def trigger_flood(intensity: float = 0.8, duration: int = 120):
    """Trigger a simulated flood event (dev mode)."""
    simulator.trigger_flood(intensity, duration)
    return {"status": "flood_triggered", "intensity": intensity, "duration": duration}


@router.post("/simulator/stop-flood")
async def stop_flood():
    """Stop the current simulated flood event."""
    simulator.stop_flood()
    return {"status": "flood_stopped"}
