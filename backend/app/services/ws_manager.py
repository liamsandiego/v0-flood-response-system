# =============================================================================
# RapidRelay – WebSocket Manager
#
# Manages WebSocket connections for real-time sensor data streaming.
# Supports multiple concurrent dashboard clients.
# =============================================================================

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Set

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("rapidrelay.ws")


class ConnectionManager:
    """Manages active WebSocket connections and broadcasts updates."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        logger.info(f"Client connected. Active: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            self.active_connections.discard(websocket)
        logger.info(f"Client disconnected. Active: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Send a JSON message to all connected clients."""
        if not self.active_connections:
            return

        payload = json.dumps(message, default=str)
        disconnected = set()

        async with self._lock:
            for ws in self.active_connections:
                try:
                    await ws.send_text(payload)
                except Exception:
                    disconnected.add(ws)

            self.active_connections -= disconnected

    async def send_personal(self, websocket: WebSocket, message: dict):
        """Send a message to a specific client."""
        try:
            await websocket.send_json(message)
        except Exception:
            await self.disconnect(websocket)

    @property
    def client_count(self) -> int:
        return len(self.active_connections)


# Singleton
ws_manager = ConnectionManager()
