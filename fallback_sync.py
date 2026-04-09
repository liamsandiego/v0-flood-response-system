"""
fallback_sync.py - Cloud to local fallback synchronization.

This worker mirrors Supabase data into local SQLite so dashboards can still serve
history when the cloud or internet is unstable.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import time
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [fallback_sync] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("fallback_sync")

try:
    from dotenv import load_dotenv

    for _p in ["../.env", ".env", "../.env.local"]:
        if Path(_p).exists():
            load_dotenv(_p)
            break
except ImportError:
    pass

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    or os.environ.get("SUPABASE_SERVICE_KEY", "")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)
SYNC_INTERVAL_S = int(os.environ.get("FALLBACK_SYNC_INTERVAL_S", "60"))
BATCH_SIZE = int(os.environ.get("SYNC_BATCH_SIZE", "100"))

INTERNET_CHECK_HOST = "1.1.1.1"
INTERNET_CHECK_PORT = 53
INTERNET_CHECK_TO = 3


def internet_available() -> bool:
    try:
        socket.setdefaulttimeout(INTERNET_CHECK_TO)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect((INTERNET_CHECK_HOST, INTERNET_CHECK_PORT))
        s.close()
        return True
    except (socket.timeout, OSError):
        return False


def supabase_reachable() -> bool:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    import urllib.request

    try:
        req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/", method="HEAD")
        req.add_header("apikey", SUPABASE_KEY)
        urllib.request.urlopen(req, timeout=5)
        return True
    except Exception:
        return False


def _get_supabase_client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase credentials not configured in .env")
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _cloud_columns(sb, table_name: str) -> set[str]:
    try:
        resp = sb.table(table_name).select("*").limit(1).execute()
        data = resp.data or []
        if data:
            return set(data[0].keys())
    except Exception:
        pass
    return set()


def _safe_get(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row.get(key) is not None:
            return row.get(key)
    return None


def _normalize_alert(value: Any) -> str:
    text = str(value or "NORMAL").upper().strip()
    mapping = {
        "NORMAL": "NORMAL",
        "WARNING": "WARNING",
        "CRITICAL": "EMERGENCY",
        "WATCH": "WATCH",
        "DANGER": "EMERGENCY",
        "CLEAR": "NORMAL",
    }
    return mapping.get(text, "NORMAL")


def _normalize_prediction_alert(row: dict[str, Any]) -> str:
    tier = _safe_get(row, "risk_tier", "alert_level")
    return _normalize_alert(tier)


def _prediction_created_at(row: dict[str, Any]) -> str | None:
    return _safe_get(row, "timestamp", "predicted_at", "created_at")


def _environmental_created_at(row: dict[str, Any]) -> str | None:
    # Prefer explicit timestamp if available; otherwise combine date/time fields.
    ts = _safe_get(row, "timestamp", "created_at")
    if ts:
        return str(ts)

    d = _safe_get(row, "Date", "date")
    t = _safe_get(row, "Time", "time")
    if d and t:
        return f"{d}T{t}"
    if d:
        return f"{d}T00:00:00"
    return None


def _pull_readings(db, sb, dry_run: bool) -> tuple[int, int]:
    conn = db.get_raw_connection()
    max_ts = conn.execute("SELECT MAX(created_at) FROM readings_local").fetchone()[0] or "1970-01-01T00:00:00Z"

    try:
        response = (
            sb.table("readings_mirror")
            .select("*")
            .gt("synced_at", max_ts)
            .order("synced_at")
            .limit(BATCH_SIZE)
            .execute()
        )
    except Exception:
        response = (
            sb.table("readings_mirror")
            .select("*")
            .order("synced_at", desc=True)
            .limit(BATCH_SIZE)
            .execute()
        )

    rows = response.data or []
    if not rows:
        return 0, 0
    if dry_run:
        return len(rows), 0

    synced = 0
    errors = 0
    for row in rows:
        try:
            db.insert_reading(
                {
                    "sensor_id": row.get("sensor_id") or "unknown",
                    "raw_mm": row.get("raw_mm"),
                    "validated_m": row.get("validated_m"),
                    "uncertainty": row.get("uncertainty"),
                    "alert_level": _normalize_alert(row.get("alert_level")),
                    "requires_human": bool(row.get("requires_human", False)),
                    "explanation": row.get("explanation"),
                    "source": row.get("source", "cloud"),
                }
            )
            synced += 1
        except Exception as e:
            errors += 1
            logger.warning("readings down-sync failed for cloud id=%s: %s", row.get("id"), e)
    return synced, errors


def _pull_environmental(db, sb, dry_run: bool) -> tuple[int, int]:
    columns = _cloud_columns(sb, "obando_environmental_data")
    if not columns:
        return 0, 0

    order_col = "timestamp" if "timestamp" in columns else ("id" if "id" in columns else None)
    query = sb.table("obando_environmental_data").select("*")
    if order_col:
        query = query.order(order_col, desc=True)
    response = query.limit(BATCH_SIZE).execute()
    rows = response.data or []
    if not rows:
        return 0, 0
    if dry_run:
        return len(rows), 0

    synced = 0
    errors = 0
    for row in rows:
        cloud_id = str(row.get("id", "")) if row.get("id") is not None else None
        if cloud_id and db.environmental_exists_by_cloud_id(cloud_id):
            continue

        try:
            db.insert_environmental(
                {
                    "cloud_id": cloud_id,
                    "sensor_id": _safe_get(row, "sensor_id", "Device", "device"),
                    "soil_moisture": _safe_get(row, "Soil Moisture", "soil_moisture"),
                    "temperature": _safe_get(row, "Temperature", "temperature"),
                    "humidity": _safe_get(row, "Humidity", "humidity"),
                    "pressure": _safe_get(row, "Pressure", "pressure"),
                    "final_distance": _safe_get(row, "Final Distance", "final_distance", "distance_m"),
                    "record_date": _safe_get(row, "Date", "date"),
                    "record_time": _safe_get(row, "Time", "time"),
                    "device": _safe_get(row, "Device", "device"),
                    "source": "cloud",
                    "synced": True,
                    "created_at": _environmental_created_at(row),
                }
            )
            synced += 1
        except Exception as e:
            errors += 1
            logger.warning("environment down-sync failed for cloud id=%s: %s", cloud_id, e)

    return synced, errors


def _pull_alerts(db, sb, dry_run: bool) -> tuple[int, int]:
    conn = db.get_raw_connection()
    max_ts = conn.execute("SELECT MAX(created_at) FROM alerts_local").fetchone()[0] or "1970-01-01T00:00:00Z"

    response = (
        sb.table("alerts")
        .select("*")
        .gt("created_at", max_ts)
        .order("created_at")
        .limit(BATCH_SIZE)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return 0, 0
    if dry_run:
        return len(rows), 0

    synced = 0
    errors = 0
    for row in rows:
        try:
            db.insert_alert(
                {
                    "alert_level": _normalize_alert(row.get("alert_level")),
                    "title": row.get("title"),
                    "message": row.get("message") or "",
                    "source": row.get("source", "cloud"),
                    "channels_sent": row.get("channels_sent")
                    if isinstance(row.get("channels_sent"), list)
                    else None,
                }
            )
            synced += 1
        except Exception as e:
            errors += 1
            logger.warning("alerts down-sync failed for cloud id=%s: %s", row.get("id"), e)

    return synced, errors


def _pull_predictions(db, sb, dry_run: bool) -> tuple[int, int]:
    conn = db.get_raw_connection()
    max_ts = conn.execute("SELECT MAX(predicted_at) FROM predictions_local").fetchone()[0] or "1970-01-01T00:00:00Z"

    cols = _cloud_columns(sb, "flood_predictions")
    ts_col = None
    for candidate in ["predicted_at", "timestamp", "created_at"]:
        if candidate in cols:
            ts_col = candidate
            break

    query = sb.table("flood_predictions").select("*")
    if ts_col:
        query = query.gt(ts_col, max_ts).order(ts_col)
    elif "id" in cols:
        query = query.order("id", desc=True)

    response = query.limit(BATCH_SIZE).execute()
    rows = response.data or []
    if not rows:
        return 0, 0
    if dry_run:
        return len(rows), 0

    synced = 0
    errors = 0
    for row in rows:
        try:
            db.insert_prediction(
                {
                    "flood_probability": float(row.get("flood_probability") or 0.0),
                    "alert_level": _normalize_prediction_alert(row),
                    "method": row.get("method", "cloud"),
                    "model_version": row.get("model_version", "cloud"),
                    "features_json": row.get("features_json"),
                }
            )
            synced += 1
        except Exception as e:
            errors += 1
            logger.warning("predictions down-sync failed for cloud id=%s: %s", row.get("id"), e)

    return synced, errors


def run_once(dry_run: bool = False) -> dict[str, Any]:
    from data_layer import get_db

    db = get_db()
    result = {
        "status": "offline",
        "readings": (0, 0),
        "environmental": (0, 0),
        "alerts": (0, 0),
        "predictions": (0, 0),
    }

    if not internet_available():
        logger.info("No internet - fallback pull skipped")
        return result
    if not supabase_reachable():
        logger.warning("Supabase unreachable - fallback pull skipped")
        result["status"] = "supabase_unreachable"
        return result

    sb = _get_supabase_client()
    t0 = time.time()

    r = _pull_readings(db, sb, dry_run)
    e = _pull_environmental(db, sb, dry_run)
    a = _pull_alerts(db, sb, dry_run)
    p = _pull_predictions(db, sb, dry_run)

    duration_ms = int((time.time() - t0) * 1000)
    err_count = r[1] + e[1] + a[1] + p[1]
    status = "success" if err_count == 0 else "partial"

    result.update(
        {
            "status": status,
            "readings": r,
            "environmental": e,
            "alerts": a,
            "predictions": p,
        }
    )

    logger.info(
        "Fallback pull done in %dms: readings=%s env=%s alerts=%s preds=%s [%s]",
        duration_ms,
        r,
        e,
        a,
        p,
        status,
    )
    return result


def run_forever(dry_run: bool = False) -> None:
    logger.info("Fallback sync started (interval=%ds)", SYNC_INTERVAL_S)
    while True:
        try:
            run_once(dry_run=dry_run)
        except Exception as e:
            logger.error("Unexpected fallback sync error: %s", e)
        time.sleep(SYNC_INTERVAL_S)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RapidRelay Fallback Cloud->Local Sync")
    parser.add_argument("--once", action="store_true", help="Sync once and exit")
    parser.add_argument("--dry-run", action="store_true", help="Simulate pull without writes")
    args = parser.parse_args()

    if args.once or args.dry_run:
        run_once(dry_run=args.dry_run)
    else:
        run_forever()
