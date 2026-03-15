# =============================================================================
# RapidRelay – IoT Sensor Simulator
#
# Simulates 5 field sensor nodes for development/testing. Generates realistic
# time-series data with smooth random walks, seasonal patterns, and occasional
# flood-like spikes. Feeds data into the backend via the same pipeline as
# real LoRaWAN sensors would.
# =============================================================================

import asyncio
import math
import random
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("rapidrelay.sim")

# ---------------------------------------------------------------------------
# Sensor node definitions (matching Obando deployment plan)
# ---------------------------------------------------------------------------

SENSOR_NODES = [
    {
        "id": "node_paliwas_01",
        "name": "Paliwas River Bridge",
        "lat": 14.7085,
        "lon": 120.9370,
        "type": "water_level",
        "base_water_level": 0.8,
        "base_rainfall": 2.0,
    },
    {
        "id": "node_catanghalan_02",
        "name": "Catanghalan Creek",
        "lat": 14.7050,
        "lon": 120.9345,
        "type": "water_level",
        "base_water_level": 0.5,
        "base_rainfall": 2.0,
    },
    {
        "id": "node_salambao_03",
        "name": "Salambao Fishpond Area",
        "lat": 14.7110,
        "lon": 120.9405,
        "type": "water_level",
        "base_water_level": 0.3,
        "base_rainfall": 1.5,
    },
    {
        "id": "node_hulo_04",
        "name": "Hulo Drainage Canal",
        "lat": 14.7040,
        "lon": 120.9350,
        "type": "water_level",
        "base_water_level": 0.6,
        "base_rainfall": 2.5,
    },
    {
        "id": "node_pagasa_05",
        "name": "PAGASA Obando Station",
        "lat": 14.707225,
        "lon": 120.937613,
        "type": "weather",
        "base_water_level": 0.0,
        "base_rainfall": 2.0,
    },
]


class SensorSimulator:
    """Generates realistic sensor data with smooth time-series behavior."""

    def __init__(self):
        self._state = {}
        self._tick = 0
        self._flood_mode = False
        self._flood_intensity = 0.0
        self.latest_readings: list[dict] = []
        self._flood_ticks_remaining = 0
        self._initialize_state()

    def _initialize_state(self):
        for node in SENSOR_NODES:
            self._state[node["id"]] = {
                "water_level": node["base_water_level"],
                "rainfall": node["base_rainfall"],
                "humidity": random.uniform(65, 80),
                "temperature": random.uniform(27, 32),
                "soil_moisture": random.uniform(40, 60),
            }

    def tick(self) -> list[dict]:
        """Generate one tick of sensor data for all nodes. Call every 5 seconds."""
        self._tick += 1

        # Randomly trigger flood events (~0.3% chance per tick, lasts 60-200 ticks)
        if not self._flood_mode and random.random() < 0.003:
            self._flood_mode = True
            self._flood_intensity = random.uniform(0.5, 1.0)
            self._flood_ticks_remaining = random.randint(60, 200)
            logger.info(f"Flood event triggered! Intensity={self._flood_intensity:.2f}, "
                       f"duration={self._flood_ticks_remaining} ticks")

        if self._flood_mode:
            self._flood_ticks_remaining -= 1
            if self._flood_ticks_remaining <= 0:
                self._flood_mode = False
                self._flood_intensity = 0.0
                logger.info("Flood event ended, returning to normal conditions")

        readings = []
        for node in SENSOR_NODES:
            reading = self._generate_reading(node)
            readings.append(reading)

        self.latest_readings = readings
        return readings

    def _generate_reading(self, node: dict) -> dict:
        """Generate a single reading with smooth random walk."""
        nid = node["id"]
        state = self._state[nid]
        base_wl = node["base_water_level"]
        base_rf = node["base_rainfall"]

        # Time-based patterns (diurnal cycle)
        hour_frac = (self._tick % 720) / 720  # 1 hour = 720 ticks @ 5s
        diurnal = math.sin(hour_frac * 2 * math.pi)

        # Random walk with mean reversion
        wl_drift = random.gauss(0, 0.02) + 0.01 * (base_wl - state["water_level"])
        rf_drift = random.gauss(0, 0.3) + 0.05 * (base_rf - state["rainfall"])
        hum_drift = random.gauss(0, 0.5) + 0.02 * (72 - state["humidity"])
        temp_drift = random.gauss(0, 0.1) + 0.01 * (29 + diurnal * 2 - state["temperature"])

        # Flood mode: increase water level and rainfall dramatically
        flood_wl_boost = 0
        flood_rf_boost = 0
        if self._flood_mode:
            ramp = min(self._flood_ticks_remaining / 30, 1.0)  # ramp up
            flood_wl_boost = self._flood_intensity * 2.5 * ramp * random.uniform(0.8, 1.2)
            flood_rf_boost = self._flood_intensity * 25 * ramp * random.uniform(0.5, 1.5)
            hum_drift += self._flood_intensity * 5

        # Update state
        state["water_level"] = max(0, state["water_level"] + wl_drift + flood_wl_boost * 0.01)
        state["rainfall"] = max(0, state["rainfall"] + rf_drift + flood_rf_boost * 0.05)
        state["humidity"] = max(40, min(100, state["humidity"] + hum_drift))
        state["temperature"] = max(20, min(40, state["temperature"] + temp_drift))
        state["soil_moisture"] = max(10, min(100,
            state["soil_moisture"] + random.gauss(0, 0.3) +
            0.1 * state["rainfall"] / 10 -
            0.05 * (state["soil_moisture"] - 50) / 50
        ))

        # Occasional sensor fault (0.5% chance)
        is_valid = random.random() > 0.005

        return {
            "sensor_id": nid,
            "name": node["name"],
            "type": node["type"],
            "latitude": node["lat"],
            "longitude": node["lon"],
            "water_level": round(state["water_level"], 3) if is_valid else None,
            "rainfall": round(state["rainfall"], 1) if is_valid else None,
            "humidity": round(state["humidity"], 1),
            "temperature": round(state["temperature"], 1),
            "soil_moisture": round(state["soil_moisture"], 1),
            "is_valid": is_valid,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "flood_mode": self._flood_mode,
        }

    def trigger_flood(self, intensity: float = 0.8, duration_ticks: int = 120):
        """Manually trigger a flood event (for testing)."""
        self._flood_mode = True
        self._flood_intensity = min(max(intensity, 0.1), 1.0)
        self._flood_ticks_remaining = duration_ticks
        logger.info(f"Manual flood triggered: intensity={intensity}, duration={duration_ticks}")

    def stop_flood(self):
        """Manually end a flood event."""
        self._flood_mode = False
        self._flood_intensity = 0.0
        self._flood_ticks_remaining = 0
        logger.info("Flood manually stopped")

    def get_status(self) -> dict:
        return {
            "tick": self._tick,
            "flood_mode": self._flood_mode,
            "flood_intensity": self._flood_intensity,
            "flood_ticks_remaining": self._flood_ticks_remaining,
            "node_count": len(SENSOR_NODES),
            "nodes": [n["id"] for n in SENSOR_NODES],
        }

    @property
    def nodes(self):
        return SENSOR_NODES


# Singleton
simulator = SensorSimulator()
