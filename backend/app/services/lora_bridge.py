"""
backend/app/services/lora_bridge.py — LoRa sensor bridge (backend service version)
RapidRelay / Obando Flood Early Warning System

Service version of the standalone lora_bridge.py.
Runs as an async background task within FastAPI when deployed on the Pi.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services import ensemble_ml as ml_service
from app.services.woody_local import explain_reading

logger = logging.getLogger("lora_bridge_svc")

import os
DB_PATH = Path(os.environ.get("LOCAL_DB_PATH", "D:/raprelay/db/local.db"))

HARD_MAX_MM = 10_000
DELTA_FLAG_MM = 500

SENSORS = {
    "OBD-01": {"name": "Obando Dike", "lat": 14.707225, "lon": 120.937613, "baseline_mm": 800},
}


def _get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.row_factory = sqlite3.Row
    return conn


def apply_hard_constraints(
    sensor_id: str, raw_mm: int, last_mm: int | None
) -> tuple[bool, bool, str | None]:
    """Returns (constraint_pass, requires_human, note)."""
    if raw_mm < 0:
        return False, False, f"DROP: raw_mm={raw_mm} < 0"
    if raw_mm > HARD_MAX_MM:
        return False, False, f"DROP: raw_mm={raw_mm} > {HARD_MAX_MM}mm"
    if last_mm is not None and abs(raw_mm - last_mm) > DELTA_FLAG_MM:
        delta = abs(raw_mm - last_mm)
        return True, True, f"FLAG: delta={delta}mm/5min > {DELTA_FLAG_MM}mm"
    return True, False, None


def process_reading_sync(sensor_id: str, raw_mm: int, use_woody: bool = True) -> dict[str, Any] | None:
    """Synchronous pipeline — call from thread pool in async context."""
    conn = _get_db()
    try:
        last_row = conn.execute(
            "SELECT raw_mm FROM readings_local WHERE sensor_id=? ORDER BY id DESC LIMIT 1",
            (sensor_id,)
        ).fetchone()
        last_mm = last_row["raw_mm"] if last_row else None

        ok, requires_human, note = apply_hard_constraints(sensor_id, raw_mm, last_mm)
        if not ok:
            logger.warning("[%s] %s", sensor_id, note)
            return None

        validated_m = raw_mm / 1000.0

        # ML prediction
        ml = ml_service.predict({
            "water_level_m": validated_m,
            "delta_m_5min": (raw_mm - last_mm) / 1000.0 if last_mm else 0.0,
            "delta_m_1hr": 0.0,
            "rainfall_mm_hr": 0.0,
            "tide_m": 0.8,
            "soil_moisture": 0.5,
            "hour": datetime.now(timezone.utc).hour,
        })

        alert_level = ml["alert_level"]
        uncertainty = ml["variance"]
        requires_human = requires_human or ml["requires_human"]

        # Woody (only for non-normal or flagged)
        explanation = None
        if use_woody and (alert_level != "NORMAL" or requires_human):
            rows = conn.execute(
                "SELECT validated_m FROM readings_local WHERE sensor_id=? ORDER BY id DESC LIMIT 12",
                (sensor_id,)
            ).fetchall()
            history = [r["validated_m"] for r in reversed(rows) if r["validated_m"]]
            explanation = explain_reading(validated_m, {"tide": 0.8, "rain": 0.0, "history": history})

        conn.execute("""
            INSERT INTO readings_local
              (sensor_id, raw_mm, validated_m, uncertainty, alert_level,
               requires_human, explanation, constraint_pass, constraint_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sensor_id, raw_mm, validated_m, uncertainty, alert_level,
            1 if requires_human else 0,
            str(explanation) if explanation else None,
            1, note,
        ))
        conn.commit()

        logger.info("[%s] %.3fm → %s | σ²=%.3f | human=%s",
                    sensor_id, validated_m, alert_level, uncertainty, requires_human)
        return {"sensor_id": sensor_id, "validated_m": validated_m,
                "alert_level": alert_level, "requires_human": requires_human}
    finally:
        conn.close()


async def process_reading(sensor_id: str, raw_mm: int) -> dict[str, Any] | None:
    """Async wrapper — runs sync pipeline in thread pool."""
    return await asyncio.to_thread(process_reading_sync, sensor_id, raw_mm)
