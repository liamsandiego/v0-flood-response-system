# =============================================================================
# RapidRelay – FastAPI Backend
#
# Core backend for the RapidRelay flood monitoring system.
# Connects: IoT sensors -> ML prediction -> WebSocket dashboard -> Alerts
#
# Architecture:
# - SQLite database for persistence (zero-config, suitable for RPi edge)
# - WebSocket for real-time sensor streaming to dashboard
# - IoT simulator for development (replaceable with real ChirpStack MQTT)
# - XGBoost ML model for flood prediction
# - Background task loop: tick sensors, predict, broadcast
# =============================================================================

import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import CORS_ORIGINS, WS_BROADCAST_INTERVAL
from app.database import init_db
from app.routers import sensors, eo, himawari, alerts, websocket, predictions, ai
from app.services.simulator import simulator
from app.services.prediction_service import prediction_service
from app.services.ws_manager import ws_manager
from app.supabase_client import get_supabase

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("rapidrelay")

# ---------------------------------------------------------------------------
# Background sensor loop
# ---------------------------------------------------------------------------

_bg_task: asyncio.Task | None = None


async def _persist_readings(rows: list[dict]):
    """Fire-and-forget: batch insert sensor readings into Supabase."""
    sb = get_supabase()
    if not sb:
        return
    try:
        await asyncio.to_thread(lambda: sb.table("sensor_readings").insert(rows).execute())
    except Exception as e:
        logger.warning("Supabase sensor insert failed: %s", e)


async def _persist_prediction(prediction: dict):
    """Fire-and-forget: insert a flood prediction into Supabase."""
    sb = get_supabase()
    if not sb:
        return
    try:
        row = {
            "flood_probability": prediction["flood_probability"],
            "alert_level": prediction["alert_level"],
            "features_json": prediction.get("features_used"),
            "method": prediction.get("method", "unknown"),
            "model_version": "v1",
        }
        await asyncio.to_thread(lambda: sb.table("flood_predictions").insert(row).execute())
    except Exception as e:
        logger.warning("Supabase prediction insert failed: %s", e)


async def _sensor_loop():
    """Background loop: tick the simulator, feed ML, broadcast to dashboards."""
    logger.info("Sensor loop started (interval=%.1fs)", WS_BROADCAST_INTERVAL)
    tick_count = 0

    while True:
        try:
            # 1. Generate sensor readings
            readings = simulator.tick()
            tick_count += 1

            # 2. Feed readings to ML prediction service
            for r in readings:
                prediction_service.ingest_reading(r)

            # 2.5 Persist sensor readings to Supabase (fire-and-forget)
            sb_rows = [{
                "sensor_id": r["sensor_id"],
                "water_level": r.get("water_level"),
                "rainfall": r.get("rainfall"),
                "humidity": r.get("humidity"),
                "soil_moisture": r.get("soil_moisture"),
                "temperature": r.get("temperature"),
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "is_valid": r.get("is_valid", True),
                "timestamp": r["timestamp"],
            } for r in readings]
            asyncio.create_task(_persist_readings(sb_rows))

            # 3. Run prediction every 12 ticks (~60s at 5s interval)
            prediction = None
            if tick_count % 12 == 0:
                prediction = prediction_service.predict()
                if prediction:
                    asyncio.create_task(_persist_prediction(prediction))

            # 4. Build GeoJSON for dashboard
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

            payload = {
                "type": "sensor_update",
                "data": {
                    "type": "FeatureCollection",
                    "features": features,
                },
                "prediction": prediction,
                "clients": ws_manager.client_count,
                "tick": tick_count,
            }

            # 5. Broadcast to all connected dashboards
            await ws_manager.broadcast(payload)

        except Exception as e:
            logger.error(f"Sensor loop error: {e}")

        await asyncio.sleep(WS_BROADCAST_INTERVAL)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _bg_task
    logger.info("RapidRelay backend starting up...")

    # Initialize database
    await init_db()

    # Start background sensor loop
    _bg_task = asyncio.create_task(_sensor_loop())

    logger.info("Backend ready. ML model loaded: %s", prediction_service.model_loaded)

    yield

    # Shutdown
    if _bg_task:
        _bg_task.cancel()
        try:
            await _bg_task
        except asyncio.CancelledError:
            pass
    logger.info("RapidRelay backend shut down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="RapidRelay Flood Monitoring API",
    version="0.2.0",
    description=(
        "Backend API for the RapidRelay hyper-localized flood early warning system. "
        "Deployed at Obando, Bulacan, Philippines. Integrates IoT sensors, "
        "Sentinel-1 SAR satellite data, and XGBoost ML flood prediction."
    ),
    lifespan=lifespan,
)

# -- CORS -------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- Routers ----------------------------------------------------------------
app.include_router(sensors.router, prefix="/api/sensors", tags=["Sensors"])
app.include_router(predictions.router, prefix="/api/predictions", tags=["Predictions"])
app.include_router(eo.router, prefix="/api/eo", tags=["Earth Observation"])
app.include_router(himawari.router, prefix="/api/himawari", tags=["Himawari"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])
app.include_router(websocket.router, tags=["WebSocket"])


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "RapidRelay Flood Monitoring API",
        "version": "0.2.0",
        "status": "running",
        "deployment": "Obando, Bulacan, Philippines",
        "ml_model": prediction_service.model_loaded,
        "ws_clients": ws_manager.client_count,
        "simulator": simulator.get_status(),
    }


@app.get("/health", tags=["Health"])
async def health():
    return {
        "status": "healthy",
        "ml_loaded": prediction_service.model_loaded,
        "ws_clients": ws_manager.client_count,
        "sim_tick": simulator.get_status()["tick"],
    }
