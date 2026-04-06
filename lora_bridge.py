"""
lora_bridge.py — LoRa → SQLite pipeline
RapidRelay / Obando Flood Early Warning System
Raspberry Pi 5 / Ubuntu deployment

Hardware path:
  ASR6601 Ra-08H node  ─[LoRa 915MHz RF]→  TTGO T-Beam (ESP32) gateway
     ├─ MQTT mode (default): TTGO → ChirpStack LNS → Mosquitto :1883
     │     topic: application/+/device/+/event/up
     └─ Serial mode (fallback): TTGO → USB → /dev/ttyUSB0
          payload format: 'SENSOR_ID:RAW_MM' (e.g. OBD-01:1234)

Data pipeline:
  LoRa chirp → hard constraints → LGBM ML → Woody (Ollama) → SQLite → SSE

Usage:
    python lora_bridge.py                       # MQTT mode (ChirpStack)
    python lora_bridge.py --mode serial         # serial fallback
    python lora_bridge.py --simulate            # dev: synthetic readings
    python lora_bridge.py --simulate --count 5  # generate N readings then stop
    python lora_bridge.py --port /dev/ttyUSB0   # override serial port
    python lora_bridge.py --mode mqtt --broker localhost:1883

Hard constraints (no ML):
    raw_mm < 0        → DROP (physically impossible)
    raw_mm > 10000    → DROP (>10m outside Obando flood envelope)
    delta > 500mm/5m  → FLAG + requires_human (surge rate implausible)
"""

from __future__ import annotations

import argparse
import base64
import glob
import json
import logging
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Configuration (env overrides .env, .env overrides defaults)
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
    for _p in ["../.env", ".env"]:
        if Path(_p).exists():
            load_dotenv(_p)
            break
except ImportError:
    pass

# DB shared with FastAPI and sync_engine — ONE file on RPi
INGEST_URL   = "http://localhost:8001/api/readings/ingest"   # FastAPI SSE notify
OLLAMA_URL   = "http://localhost:11434/api/generate"
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")

HARD_MAX_MM   = 10_000   # >10m → drop
DELTA_FLAG_MM = 500      # >0.5m in 5min → flag

# Sensor registry (Obando deployment) — sensor_id must match TTGO/ChirpStack device EUI mapping
SENSORS = {
    "OBD-01": {"name": "Angat River North", "lat": 14.8369, "lon": 120.9592, "baseline_mm": 800},
    "OBD-02": {"name": "San Pascual Canal",  "lat": 14.8285, "lon": 120.9480, "baseline_mm": 600},
    "OBD-03": {"name": "Poblacion Bridge",   "lat": 14.8411, "lon": 120.9551, "baseline_mm": 700},
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [lora_bridge] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("lora_bridge")


# ---------------------------------------------------------------------------
# Data layer — shared SQLite abstraction
# ---------------------------------------------------------------------------

def _get_db():
    """Import data_layer lazily so lora_bridge can run standalone."""
    try:
        from data_layer import get_db
        return get_db()
    except ImportError:
        logger.error("data_layer.py not found — ensure it is in the same directory.")
        raise


# ---------------------------------------------------------------------------
# Hard constraint checker
# ---------------------------------------------------------------------------

def apply_hard_constraints(
    sensor_id: str, raw_mm: int, last_mm: int | None
) -> tuple[bool, bool, str | None]:
    """
    Returns (constraint_pass, requires_human, note)
    constraint_pass=False → drop reading entirely.
    """
    if raw_mm < 0:
        return False, False, f"DROP: raw_mm={raw_mm} < 0 (physically impossible)"
    if raw_mm > HARD_MAX_MM:
        return False, False, f"DROP: raw_mm={raw_mm} > {HARD_MAX_MM}mm (outside flood envelope)"

    if last_mm is not None:
        delta = abs(raw_mm - last_mm)
        if delta > DELTA_FLAG_MM:
            return True, True, f"FLAG: delta={delta}mm in 5min exceeds {DELTA_FLAG_MM}mm threshold"

    return True, False, None


# ---------------------------------------------------------------------------
# ML prediction (NewPhase ensemble or backend API)
# ---------------------------------------------------------------------------

_ensemble = None
_reading_buffer: list[dict] = []  # Rolling buffer for NewPhase features


def _get_ensemble():
    """Load the NewPhase ensemble ML module."""
    global _ensemble
    if _ensemble is not None:
        return _ensemble

    try:
        from ensemble_ml import get_ensemble
        _ensemble = get_ensemble()
        if _ensemble.loaded:
            logger.info("Loaded NewPhase ensemble: %s", list(_ensemble.models.keys()))
            return _ensemble
    except Exception as e:
        logger.warning("Could not load ensemble_ml: %s", e)

    logger.warning("No ML ensemble available — using rule-based fallback")
    return None


def predict_via_backend(reading_data: dict) -> tuple[str, float | None, bool] | None:
    """Try to get prediction from FastAPI backend. Returns None if unavailable."""
    try:
        resp = requests.post(
            "http://localhost:8001/api/predictions/current",
            json=reading_data,
            timeout=3,
        )
        if resp.ok:
            data = resp.json()
            level = data.get("alert_level", "CLEAR")
            prob = data.get("flood_probability", 0.0)
            # Map to lora_bridge levels
            level_map = {"CLEAR": "NORMAL", "WATCH": "WATCH", "WARNING": "WARNING", "DANGER": "EMERGENCY"}
            return level_map.get(level, level), prob, False
    except Exception:
        pass
    return None


def predict_alert_level(
    validated_m: float,
    delta_m: float = 0.0,
    rainfall_mm_hr: float = 0.0,
    tide_m: float = 0.8,
    humidity: float = 70.0,
    soil_moisture: float = 0.3,
) -> tuple[str, float | None, bool]:
    """
    Returns (alert_level, uncertainty, requires_human).
    Uses NewPhase ensemble (3 models on 40 features) if available, falls back to rule-based.
    Alert levels: CLEAR, WATCH, WARNING, DANGER (aligned with backend).
    """
    # Add reading to buffer for NewPhase features
    global _reading_buffer
    _reading_buffer.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "water_level": validated_m,
        "humidity": humidity,
        "soil_moisture": soil_moisture,
    })
    # Keep 72 hours of data
    if len(_reading_buffer) > 72:
        _reading_buffer = _reading_buffer[-72:]

    # Try NewPhase ensemble (requires 48+ readings)
    ensemble = _get_ensemble()
    if ensemble and len(_reading_buffer) >= 48:
        try:
            result = ensemble.predict_from_buffer(_reading_buffer, freq="1h")
            if result and "mean_prob" in result and result.get("model_count", 0) > 0:
                prob = result["mean_prob"]
                variance = result.get("variance", 0)

                # Map probability to alert level (aligned with backend)
                if prob >= 0.75:
                    level = "DANGER"
                elif prob >= 0.50:
                    level = "WARNING"
                elif prob >= 0.25:
                    level = "WATCH"
                else:
                    level = "CLEAR"

                # Require human if high variance between models
                requires_human = variance > 0.15

                logger.debug(
                    "Ensemble prediction: prob=%.3f, var=%.4f, level=%s",
                    prob, variance, level
                )
                return level, variance, requires_human
        except Exception as e:
            logger.warning("Ensemble prediction failed: %s", e)

    # Rule-based fallback (always works, even without ML)
    if validated_m >= 2.5:
        return "DANGER", None, False
    elif validated_m >= 2.0:
        return "WARNING", None, False
    elif validated_m >= 1.5:
        return "WATCH", None, False
    return "CLEAR", None, False


# ---------------------------------------------------------------------------
# Woody (Ollama) explanation — only on alerts / flagged readings
# ---------------------------------------------------------------------------

def get_woody_explanation(reading_m: float, context: dict[str, Any]) -> dict | None:
    """Call Ollama locally. Returns None gracefully if offline."""
    prompt = f"""You are a hydrology assistant for Obando, Bulacan.

HARD DATA (verify before using):
- Sensor reading: {reading_m:.3f}m
- Tide: {context.get('tide', 'N/A')}m
- Rain: {context.get('rain', 0)}mm/hr
- History: last 6hr readings (oldest→newest): {context.get('history_str', 'unavailable')}

TASK: List 3 possibilities for this reading:
1. Most likely physical cause if reading is accurate
2. Most likely sensor malfunction if reading is inaccurate
3. Worst-case scenario if reading is true

RULES:
- Do NOT say "valid" or "invalid"
- Do NOT give confidence percentages

Output JSON only: {{"possibilities": ["<str>", "<str>", "<str>"], "sentinel_disagreement": false}}"""

    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "format": "json"},
            timeout=15,
        )
        resp.raise_for_status()
        return json.loads(resp.json()["response"])
    except requests.exceptions.RequestException as e:
        logger.warning("Ollama offline or timeout: %s", e)
        return None
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning("Ollama response parse error: %s", e)
        return None


# ---------------------------------------------------------------------------
# Full pipeline for one reading
# ---------------------------------------------------------------------------

def process_reading(
    sensor_id: str,
    raw_mm: int,
    source: str = "lora",
    use_woody: bool = True,
) -> dict[str, Any] | None:
    """
    Run one reading through the full pipeline.
    Returns the stored record dict, or None if dropped.
    Writes to SQLite via data_layer — always succeeds even if Supabase is down.
    """
    db = _get_db()

    last_mm = db.get_last_reading_mm(sensor_id)
    constraint_pass, requires_human_constraint, note = apply_hard_constraints(
        sensor_id, raw_mm, last_mm
    )

    if not constraint_pass:
        logger.warning("[%s] %s", sensor_id, note)
        # Try to buffer to offline_buffer in case of edge races
        return None

    if note:
        logger.warning("[%s] %s", sensor_id, note)

    validated_m = raw_mm / 1000.0
    delta_m = (raw_mm - last_mm) / 1000.0 if last_mm is not None else 0.0

    alert_level, uncertainty, requires_human_ml = predict_alert_level(
        validated_m, delta_m=delta_m
    )
    requires_human = requires_human_constraint or requires_human_ml

    # Woody explanation (only for non-CLEAR or flagged)
    explanation = None
    if use_woody and (alert_level != "CLEAR" or requires_human):
        recent = db.get_recent_readings(sensor_id, limit=12)
        history = [r["validated_m"] for r in reversed(recent) if r.get("validated_m")]
        history_str = " → ".join(f"{v:.2f}m" for v in history[-6:]) or "no history"
        explanation = get_woody_explanation(validated_m, {
            "tide": 0.8,
            "rain": 0.0,
            "history_str": history_str,
        })
        if explanation:
            logger.info("[%s] Woody: %s", sensor_id, explanation.get("possibilities", []))

    record: dict[str, Any] = {
        "sensor_id":       sensor_id,
        "raw_mm":          raw_mm,
        "validated_m":     validated_m,
        "uncertainty":     uncertainty,
        "alert_level":     alert_level,
        "requires_human":  requires_human,
        "explanation":     explanation,
        "constraint_pass": constraint_pass,
        "constraint_note": note,
        "source":          source,
    }

    # Write to SQLite first (always, even if network is down)
    try:
        record_id = db.insert_reading(record)
        record["id"] = record_id
    except Exception as e:
        logger.error("[%s] SQLite insert failed: %s — buffering", sensor_id, e)
        db.buffer_raw_payload(sensor_id, {"raw_mm": raw_mm}, source=source)
        return None

    logger.info(
        "[%s] %.3fm → %s | uncertainty=%s | human=%s | src=%s",
        sensor_id, validated_m, alert_level,
        f"{uncertainty:.3f}" if uncertainty else "N/A",
        requires_human, source,
    )

    # Write alert to alerts_local if level is not CLEAR
    if alert_level != "CLEAR":
        try:
            db.insert_alert({
                "alert_level": alert_level,
                "title":       f"{alert_level}: {SENSORS.get(sensor_id, {}).get('name', sensor_id)}",
                "message":     f"Water level at {validated_m:.2f}m ({alert_level}). {note or ''}",
                "source":      "system",
                "sensor_id":   sensor_id,
                "reading_id":  record_id,
            })
        except Exception as e:
            logger.warning("[%s] Alert insert failed: %s", sensor_id, e)

    # Notify FastAPI SSE (fire-and-forget — ok to fail)
    try:
        requests.post(INGEST_URL, json=record, timeout=2)
    except Exception:
        pass  # FastAPI SSE will poll SQLite anyway

    return record


# ---------------------------------------------------------------------------
# MQTT mode — ChirpStack via Mosquitto
# ---------------------------------------------------------------------------

def parse_chirpstack_payload(msg_payload: bytes) -> tuple[str, int] | None:
    """
    Parse a ChirpStack MQTT uplink message.
    Expected JSON structure (ChirpStack v4):
    {
      "deviceInfo": {"deviceName": "OBD-01", ...},
      "object": {"raw_mm": 1234}   ← decoded via ChirpStack codec
    }
    Falls back to base64 frm payload if object not decoded.
    """
    try:
        data = json.loads(msg_payload)

        # Try decoded object first (requires ChirpStack payload codec set up)
        obj = data.get("object", {})
        if "raw_mm" in obj:
            sensor_id = data["deviceInfo"]["deviceName"]
            return sensor_id, int(obj["raw_mm"])

        # Try base64 frmPayload (raw bytes): format 'SENSOR_ID:RAW_MM'
        frm = data.get("data", "")
        if frm:
            decoded = base64.b64decode(frm).decode("ascii").strip()
            parts = decoded.split(":")
            if len(parts) == 2:
                return parts[0].strip(), int(parts[1].strip())

        logger.warning("ChirpStack payload has no recognized format: %s", list(data.keys()))
        return None
    except Exception as e:
        logger.warning("ChirpStack payload parse error: %s", e)
        return None


def run_mqtt(broker_host: str = "localhost", broker_port: int = 1883) -> None:
    """Subscribe to ChirpStack MQTT and process uplinks forever."""
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        logger.error("paho-mqtt not installed: pip install paho-mqtt")
        sys.exit(1)

    TOPIC = "application/+/device/+/event/up"

    def on_connect(client, userdata, flags, rc, properties=None):
        if rc == 0:
            logger.info("Connected to MQTT broker %s:%d", broker_host, broker_port)
            client.subscribe(TOPIC)
            logger.info("Subscribed to: %s", TOPIC)
        else:
            logger.error("MQTT connect failed, rc=%d", rc)

    def on_message(client, userdata, msg):
        parsed = parse_chirpstack_payload(msg.payload)
        if parsed:
            sensor_id, raw_mm = parsed
            process_reading(sensor_id, raw_mm, source="mqtt")
        else:
            logger.debug("Unrecognized MQTT message on %s", msg.topic)

    def on_disconnect(client, userdata, rc, properties=None, something=None):
        logger.warning("MQTT disconnected (rc=%d) — reconnecting in 5s...", rc)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect    = on_connect
    client.on_message    = on_message
    client.on_disconnect = on_disconnect

    while True:
        try:
            client.connect(broker_host, broker_port, keepalive=60)
            client.loop_forever()
        except ConnectionRefusedError:
            logger.error("MQTT broker not reachable at %s:%d — retrying in 10s...", broker_host, broker_port)
            time.sleep(10)
        except KeyboardInterrupt:
            logger.info("Bridge stopped by user.")
            break
        except Exception as e:
            logger.error("MQTT error: %s — retrying in 5s...", e)
            time.sleep(5)


# ---------------------------------------------------------------------------
# Serial mode — TTGO T-Beam direct USB (fallback)
# ---------------------------------------------------------------------------

def auto_detect_serial_port() -> str | None:
    """Scan for likely LoRa USB serial ports on Linux."""
    candidates = []
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*"]:
        candidates.extend(sorted(glob.glob(pattern)))
    if candidates:
        logger.info("Auto-detected serial ports: %s — using %s", candidates, candidates[0])
        return candidates[0]
    logger.warning("No serial ports found (/dev/ttyUSB* or /dev/ttyACM*)")
    return None


def parse_serial_payload(raw: bytes) -> tuple[str, int] | None:
    """
    Parse direct serial payload. Expected: 'SENSOR_ID:RAW_MM'
    Example: b'OBD-01:1234'
    Also handles JSON: {"sensor_id": "OBD-01", "raw_mm": 1234}
    """
    try:
        text = raw.decode("ascii", errors="ignore").strip()
        if not text:
            return None
        # Try JSON first
        if text.startswith("{"):
            data = json.loads(text)
            return data["sensor_id"], int(data["raw_mm"])
        # Try colon-separated
        parts = text.split(":")
        if len(parts) == 2:
            return parts[0].strip(), int(parts[1].strip())
    except Exception:
        pass
    return None


def run_serial(port: str) -> None:
    """Read from LoRa USB serial port forever."""
    try:
        import serial
    except ImportError:
        logger.error("pyserial not installed: pip install pyserial")
        sys.exit(1)

    logger.info("Opening serial port %s at 115200 baud...", port)
    while True:
        try:
            ser = serial.Serial(port, baudrate=115200, timeout=5)
            logger.info("Serial port open: %s", port)
            while True:
                line = ser.readline()
                if not line:
                    continue
                parsed = parse_serial_payload(line)
                if parsed:
                    sensor_id, raw_mm = parsed
                    process_reading(sensor_id, raw_mm, source="serial")
                else:
                    logger.debug("Unrecognized serial: %r", line[:60])
        except Exception as e:
            logger.error("Serial error on %s: %s — retrying in 5s...", port, e)
            time.sleep(5)


# ---------------------------------------------------------------------------
# Simulator mode
# ---------------------------------------------------------------------------

def run_simulate(count: int | None = None, interval: float = 5.0) -> None:
    """Simulate LoRa readings for development (no hardware required)."""
    logger.info("Running in SIMULATE mode (interval=%.1fs)", interval)
    sensor_ids = list(SENSORS.keys())
    iteration  = 0

    while count is None or iteration < count:
        for sensor_id in sensor_ids:
            baseline = SENSORS[sensor_id]["baseline_mm"]
            drift    = random.gauss(0, 20)
            raw_mm   = max(0, baseline + int(drift) + (iteration * 3))
            process_reading(sensor_id, raw_mm, source="simulate", use_woody=False)

        iteration += 1
        if count is None or iteration < count:
            time.sleep(interval)

    logger.info("Simulation complete (%d iterations)", iteration)


# ---------------------------------------------------------------------------
# Startup: drain offline buffer
# ---------------------------------------------------------------------------

def drain_offline_buffer_on_start() -> None:
    """Process any readings that were buffered during a previous crash/lock."""
    try:
        db = _get_db()
        buffered = db.drain_offline_buffer()
        if buffered:
            logger.info("Draining %d offline-buffered payloads from previous session...", len(buffered))
            for entry in buffered:
                try:
                    payload = json.loads(entry["raw_payload"])
                    raw_mm = payload.get("raw_mm")
                    if raw_mm is not None:
                        process_reading(
                            entry["sensor_id"], int(raw_mm),
                            source=entry.get("source", "lora"),
                            use_woody=False,
                        )
                except Exception as e:
                    logger.warning("Could not replay buffered entry %d: %s", entry["id"], e)
    except Exception as e:
        logger.warning("Could not drain offline buffer: %s", e)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RapidRelay LoRa Bridge")
    parser.add_argument(
        "--mode", choices=["mqtt", "serial", "simulate"], default="mqtt",
        help="Input mode. 'mqtt' = ChirpStack (default), 'serial' = direct USB, 'simulate' = no hardware",
    )
    parser.add_argument("--simulate",  action="store_true", help="Shorthand for --mode simulate")
    parser.add_argument("--count",     type=int,   default=None,         help="Simulate: stop after N iterations")
    parser.add_argument("--interval",  type=float, default=5.0,          help="Simulate: interval in seconds")
    parser.add_argument("--port",      default="auto",                   help="Serial: port path or 'auto'")
    parser.add_argument("--broker",    default="localhost",              help="MQTT: broker host")
    parser.add_argument("--mqtt-port", type=int,   default=1883,         help="MQTT: broker port")
    parser.add_argument("--db",        default=None,                     help="Override SQLite DB path")
    args = parser.parse_args()

    # Shorthand
    if args.simulate:
        args.mode = "simulate"

    if args.db:
        import data_layer
        data_layer.DB_PATH = Path(args.db)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [lora_bridge] %(levelname)s: %(message)s",
    )
    logger.info("RapidRelay LoRa Bridge starting... mode=%s db=%s", args.mode, os.environ.get("LOCAL_DB_PATH", "(default)"))

    # Always drain buffer from prior sessions first
    drain_offline_buffer_on_start()

    try:
        if args.mode == "simulate":
            run_simulate(count=args.count, interval=args.interval)
        elif args.mode == "serial":
            port = args.port
            if port == "auto":
                port = auto_detect_serial_port()
                if not port:
                    logger.error("No serial port found. Connect TTGO T-Beam and retry, or specify --port /dev/ttyUSBx")
                    sys.exit(1)
            run_serial(port)
        else:  # mqtt (default)
            run_mqtt(broker_host=args.broker, broker_port=args.mqtt_port)
    except KeyboardInterrupt:
        logger.info("Bridge stopped by user.")
