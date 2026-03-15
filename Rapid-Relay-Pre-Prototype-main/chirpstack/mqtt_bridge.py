#!/usr/bin/env python3
"""
RapidRelay – ChirpStack MQTT → Supabase Bridge

Listens to ChirpStack MQTT uplink events and inserts sensor readings into
Supabase Postgres. Runs on the same Raspberry Pi as ChirpStack.

Usage:
    pip install paho-mqtt supabase python-dotenv
    python mqtt_bridge.py

Environment variables (or .env file):
    MQTT_BROKER       ChirpStack Mosquitto host  (default: localhost)
    MQTT_PORT         MQTT port                   (default: 1883)
    MQTT_TOPIC        ChirpStack uplink topic     (default: application/+/device/+/event/up)
    SUPABASE_URL      Supabase project URL
    SUPABASE_SERVICE_KEY  Supabase service role key

ChirpStack publishes uplink events as JSON to:
    application/{app_id}/device/{dev_eui}/event/up

The payload is base64-encoded in `data` field. This bridge expects the
sensor node firmware to encode readings as a simple binary struct:
    [water_level:f32] [rainfall:f32] [humidity:f32] [soil_moisture:f32] [temperature:f32]
    = 20 bytes total, little-endian

Adjust decode_payload() to match your actual firmware encoding.
"""

import json
import struct
import base64
import logging
import os
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [MQTT-Bridge] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mqtt-bridge")

# ── Config ────────────────────────────────────────────────────────────────────

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "application/+/device/+/event/up")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# ── Supabase client ──────────────────────────────────────────────────────────

sb = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    logger.info("Supabase client initialized")
else:
    logger.warning("Supabase not configured — will log readings to console only")

# ── Device registry (map dev_eui → sensor metadata) ─────────────────────────
# Update these with your actual device EUIs after registering in ChirpStack

DEVICE_REGISTRY = {
    # "dev_eui_hex": { "sensor_id": "...", "name": "...", "lat": ..., "lon": ... }
    "0000000000000001": {"sensor_id": "obando-brgy-01", "name": "Brgy. Binuangan",  "lat": 14.7094, "lon": 120.9358},
    "0000000000000002": {"sensor_id": "obando-brgy-02", "name": "Brgy. Catanghalan", "lat": 14.7120, "lon": 120.9310},
    "0000000000000003": {"sensor_id": "obando-brgy-03", "name": "Brgy. Paco",        "lat": 14.7060, "lon": 120.9400},
    "0000000000000004": {"sensor_id": "obando-brgy-04", "name": "Brgy. Salambao",    "lat": 14.7140, "lon": 120.9280},
    "0000000000000005": {"sensor_id": "obando-brgy-05", "name": "Brgy. PAGASA Stn",  "lat": 14.7072, "lon": 120.9376},
}


def decode_payload(b64_data: str) -> dict | None:
    """
    Decode the LoRaWAN payload from base64.

    Expected firmware encoding (20 bytes, little-endian):
        water_level  : float32 (meters)
        rainfall     : float32 (mm)
        humidity     : float32 (%)
        soil_moisture: float32 (%)
        temperature  : float32 (°C)

    Adjust this function to match your actual firmware payload format.
    """
    try:
        raw = base64.b64decode(b64_data)
        if len(raw) < 20:
            logger.warning("Payload too short: %d bytes (expected 20)", len(raw))
            return None
        water_level, rainfall, humidity, soil_moisture, temperature = struct.unpack("<5f", raw[:20])
        return {
            "water_level": round(water_level, 4),
            "rainfall": round(rainfall, 2),
            "humidity": round(humidity, 2),
            "soil_moisture": round(soil_moisture, 2),
            "temperature": round(temperature, 2),
        }
    except Exception as e:
        logger.error("Payload decode error: %s", e)
        return None


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("Connected to MQTT broker at %s:%d", MQTT_BROKER, MQTT_PORT)
        client.subscribe(MQTT_TOPIC)
        logger.info("Subscribed to: %s", MQTT_TOPIC)
    else:
        logger.error("MQTT connection failed with code %d", rc)


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())

        # Extract device EUI from the ChirpStack event
        dev_eui = payload.get("deviceInfo", {}).get("devEui", "")
        if not dev_eui:
            # Fallback: try older ChirpStack v3 format
            dev_eui = payload.get("devEUI", "")

        device = DEVICE_REGISTRY.get(dev_eui)
        if not device:
            logger.debug("Unknown device %s — skipping", dev_eui)
            return

        # Decode sensor data from the uplink payload
        data_b64 = payload.get("data", "")
        if not data_b64:
            logger.warning("No data field in uplink from %s", dev_eui)
            return

        readings = decode_payload(data_b64)
        if not readings:
            return

        # Build the row for Supabase
        row = {
            "sensor_id": device["sensor_id"],
            "water_level": readings["water_level"],
            "rainfall": readings["rainfall"],
            "humidity": readings["humidity"],
            "soil_moisture": readings["soil_moisture"],
            "temperature": readings["temperature"],
            "latitude": device["lat"],
            "longitude": device["lon"],
            "is_valid": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "[%s] WL=%.3fm RAIN=%.1fmm HUM=%.1f%% SOIL=%.1f%% TEMP=%.1f°C",
            device["sensor_id"],
            readings["water_level"],
            readings["rainfall"],
            readings["humidity"],
            readings["soil_moisture"],
            readings["temperature"],
        )

        # Insert into Supabase
        if sb:
            try:
                sb.table("sensor_readings").insert(row).execute()
            except Exception as e:
                logger.error("Supabase insert failed: %s", e)
        else:
            logger.info("(dry run) Would insert: %s", json.dumps(row, indent=2))

    except Exception as e:
        logger.error("Message processing error: %s", e)


def main():
    logger.info("RapidRelay MQTT Bridge starting...")
    logger.info("Broker: %s:%d", MQTT_BROKER, MQTT_PORT)
    logger.info("Topic:  %s", MQTT_TOPIC)
    logger.info("Devices registered: %d", len(DEVICE_REGISTRY))

    client = mqtt.Client(client_id="rapidrelay-bridge")
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_forever()


if __name__ == "__main__":
    main()
