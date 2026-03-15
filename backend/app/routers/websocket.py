# =============================================================================
# RapidRelay – WebSocket Router
#
# Provides real-time sensor data streaming to dashboard clients.
# Protocol: JSON messages over WebSocket at /api/ws
# =============================================================================

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.ws_manager import ws_manager

router = APIRouter()


@router.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time sensor updates.

    Protocol:
    - Server sends JSON messages every 5 seconds with sensor GeoJSON
    - Client can send: {"type": "ping"} for keep-alive
    - Client can send: {"type": "trigger_flood", "intensity": 0.8} for testing

    Message format (server -> client):
    {
        "type": "sensor_update",
        "data": { GeoJSON FeatureCollection },
        "prediction": { flood_probability, alert_level, method },
        "clients": <int>,
        "tick": <int>
    }
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await ws_manager.send_personal(websocket, {"type": "pong"})

            elif msg_type == "trigger_flood":
                from app.services.simulator import simulator
                intensity = data.get("intensity", 0.8)
                duration = data.get("duration", 120)
                simulator.trigger_flood(intensity, duration)
                await ws_manager.send_personal(websocket, {
                    "type": "flood_triggered",
                    "intensity": intensity,
                    "duration": duration,
                })

            elif msg_type == "stop_flood":
                from app.services.simulator import simulator
                simulator.stop_flood()
                await ws_manager.send_personal(websocket, {"type": "flood_stopped"})

    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)
