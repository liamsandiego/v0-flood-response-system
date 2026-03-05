# =============================================================================
# RapidRelay – Sensor Router
# =============================================================================

from fastapi import APIRouter, Query
from typing import List

from app.services.sensor_service import generate_snapshot, generate_sensor_reading
from app.models.schemas import SensorSnapshot, SensorReading

router = APIRouter()


@router.get("/latest", response_model=SensorSnapshot)
async def get_latest_sensors():
    """Return the latest sensor snapshot.

    Phase 1: generates mock data.
    Phase 2: polls real LoRaWAN / MQTT broker.
    """
    return generate_snapshot()


@router.get("/reading/{sensor_id}", response_model=SensorReading)
async def get_sensor_reading(sensor_id: str):
    """Return a single reading for one sensor."""
    return generate_sensor_reading(sensor_id)


@router.get("/history", response_model=List[SensorSnapshot])
async def get_sensor_history(
    limit: int = Query(default=20, le=200, description="Number of historical snapshots"),
):
    """Return multiple recent snapshots.

    Phase 1: generates N random snapshots (no DB persistence yet).
    Phase 2: queries TimescaleDB / InfluxDB.
    """
    return [generate_snapshot() for _ in range(limit)]
