"""
fallback_sync.py — Background cloud sync daemon (Fallback Mode)
RapidRelay / Obando Flood Early Warning System
Raspberry Pi 5 / Ubuntu deployment

Syncs DOWN: Supabase → local.db
This acts as a backup system fetching data from Supabase to serve 
as local persistence in case this Raspberry Pi has no internet.

Usage:
    python fallback_sync.py              # Run forever (60s sync interval)
    python fallback_sync.py --once       # Sync once and exit
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import socket
import time
from datetime import datetime, timezone
from pathlib import Path

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

SUPABASE_URL  = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY  = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    or os.environ.get("SUPABASE_SERVICE_KEY", "")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)
SYNC_INTERVAL_S      = int(os.environ.get("FALLBACK_SYNC_INTERVAL_S", "60"))   # 1 min default for fallback
BATCH_SIZE           = int(os.environ.get("SYNC_BATCH_SIZE", "100"))

INTERNET_CHECK_HOST  = "1.1.1.1"
INTERNET_CHECK_PORT  = 53
INTERNET_CHECK_TO    = 3

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
    if not SUPABASE_URL:
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
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except ImportError:
        raise RuntimeError("supabase-py not installed")

def _get_max_local_timestamp(db, table_name: str, time_col: str = "created_at") -> str:
    """Gets the most recent timestamp in a local table to use for Deltas."""
    try:
        conn = db.get_connection()
        cur = conn.cursor()
        cur.execute(f"SELECT MAX({time_col}) FROM {table_name}")
        row = cur.fetchone()
        if row and row[0]:
            return row[0]
    except Exception as e:
        logger.warning(f"Error checking max timestamp for {table_name}: {e}")
    # Default to 1 hour ago if empty, to catch initial load but not pull everything forever if we want to limit
    # Actually, let's default to epoch if we want full sync
    return "1970-01-01T00:00:00Z"

def map_alert_level_from_supabase(sb_level: str) -> str:
    mapping = {
        "normal":   "NORMAL",
        "warning":  "WARNING",
        "critical": "DANGER",
    }
    # Fallback to caps if not matched
    return mapping.get(sb_level.lower(), sb_level.upper())

def sync_readings_down(db, dry_run: bool = False) -> tuple[int, int]:
    sb = _get_supabase_client()
    max_ts = _get_max_local_timestamp(db, "readings_local", "created_at")
    
    try:
        response = sb.table("readings_mirror") \
            .select("*") \
            .gt("created_at", max_ts) \
            .order("created_at") \
            .limit(BATCH_SIZE) \
            .execute()
            
        data = response.data or []
        if not data:
            return 0, 0
            
        logger.info(f"readings_mirror: pulling {len(data)} new rows from cloud")
        
        if dry_run:
            return len(data), 0
            
        conn = db.get_connection()
        synced = errors = 0
        
        for row in data:
            try:
                # In Supabase, the created_at is the cloud creation time, local_created_at is original
                c_at = row.get("local_created_at") or row.get("created_at")
                
                cur = conn.cursor()
                cur.execute('''
                    INSERT INTO readings_local 
                    (sensor_id, raw_mm, validated_m, uncertainty, alert_level, requires_human, explanation, source, synced, cloud_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                ''', (
                    row.get("sensor_id", "unknown"),
                    row.get("raw_mm"),
                    row.get("validated_m"),
                    row.get("uncertainty"),
                    row.get("alert_level"),
                    row.get("requires_human", False),
                    json.dumps(row.get("explanation")) if isinstance(row.get("explanation"), dict) else row.get("explanation"),
                    row.get("source", "cloud"),
                    str(row.get("id", "")),
                    c_at
                ))
                synced += 1
            except Exception as e:
                logger.error(f"Error inserting reading id={row.get('id')}: {e}")
                errors += 1
                
        conn.commit()
        return synced, errors
        
    except Exception as e:
        logger.error(f"Failed to fetch readings_mirror: {e}")
        return 0, 1

def sync_alerts_down(db, dry_run: bool = False) -> tuple[int, int]:
    sb = _get_supabase_client()
    max_ts = _get_max_local_timestamp(db, "alerts_local", "created_at")
    
    try:
        response = sb.table("alerts") \
            .select("*") \
            .gt("created_at", max_ts) \
            .order("created_at") \
            .limit(BATCH_SIZE) \
            .execute()
            
        data = response.data or []
        if not data:
            return 0, 0
            
        logger.info(f"alerts: pulling {len(data)} new rows from cloud")
        if dry_run:
            return len(data), 0
            
        conn = db.get_connection()
        synced = errors = 0
        
        for row in data:
            try:
                cur = conn.cursor()
                cur.execute('''
                    INSERT INTO alerts_local 
                    (alert_level, title, message, source, acknowledged, synced, cloud_id, created_at)
                    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                ''', (
                    map_alert_level_from_supabase(row.get("alert_level", "normal")),
                    row.get("title"),
                    row.get("message", ""),
                    row.get("source", "cloud"),
                    row.get("acknowledged", False),
                    str(row.get("id", "")),
                    row.get("created_at")
                ))
                synced += 1
            except Exception as e:
                logger.error(f"Error inserting alert id={row.get('id')}: {e}")
                errors += 1
                
        conn.commit()
        return synced, errors
        
    except Exception as e:
        logger.error(f"Failed to fetch alerts: {e}")
        return 0, 1

def sync_predictions_down(db, dry_run: bool = False) -> tuple[int, int]:
    sb = _get_supabase_client()
    max_ts = _get_max_local_timestamp(db, "predictions_local", "predicted_at")
    
    try:
        response = sb.table("flood_predictions") \
            .select("*") \
            .gt("created_at", max_ts) \
            .order("created_at") \
            .limit(BATCH_SIZE) \
            .execute()
            
        data = response.data or []
        if not data:
            return 0, 0
            
        logger.info(f"predictions: pulling {len(data)} new rows from cloud")
        if dry_run:
            return len(data), 0
            
        conn = db.get_connection()
        synced = errors = 0
        
        for row in data:
            try:
                cur = conn.cursor()
                cur.execute('''
                    INSERT INTO predictions_local 
                    (flood_probability, alert_level, method, model_version, synced, cloud_id, predicted_at)
                    VALUES (?, ?, ?, ?, 1, ?, ?)
                ''', (
                    row.get("flood_probability", 0.0),
                    row.get("alert_level", "NORMAL"),
                    row.get("method", "lgbm"),
                    row.get("model_version", "v2"),
                    str(row.get("id", "")),
                    row.get("created_at")
                ))
                synced += 1
            except Exception as e:
                logger.error(f"Error inserting prediction id={row.get('id')}: {e}")
                errors += 1
                
        conn.commit()
        return synced, errors
        
    except Exception as e:
        logger.error(f"Failed to fetch predictions: {e}")
        return 0, 1

def run_once(dry_run: bool = False) -> dict:
    from data_layer import get_db
    db = get_db()
    
    result = {
        "readings": (0, 0),
        "alerts":   (0, 0),
        "preds":    (0, 0),
        "status":   "offline",
    }
    
    if not internet_available():
        logger.info("No internet — skipping pull.")
        return result
        
    if not supabase_reachable():
        logger.warning("Supabase not reachable.")
        result["status"] = "supabase_unreachable"
        return result
        
    t_start = time.time()
    
    r_syn, r_err = sync_readings_down(db, dry_run)
    a_syn, a_err = sync_alerts_down(db, dry_run)
    p_syn, p_err = sync_predictions_down(db, dry_run)
    
    errors_total = r_err + a_err + p_err
    duration_ms = int((time.time() - t_start) * 1000)
    
    status = "success" if errors_total == 0 else "partial"
    
    logger.info(
        "Pull done in %dms: readings=(%d,%d) alerts=(%d,%d) preds=(%d,%d) [%s]",
        duration_ms,
        r_syn, r_err, a_syn, a_err, p_syn, p_err, status,
    )
    
    result.update({
        "readings": (r_syn, r_err),
        "alerts":   (a_syn, a_err),
        "preds":    (p_syn, p_err),
        "status":   status
    })
    
    return result

def run_forever(dry_run: bool = False) -> None:
    logger.info("Fallback Sync engine started (interval=%ds)", SYNC_INTERVAL_S)
    logger.info("Pulling data from: %s", SUPABASE_URL)
    
    while True:
        try:
            run_once(dry_run=dry_run)
        except Exception as e:
            logger.error("Unexpected error in fallback sync loop: %s", e)
            
        time.sleep(SYNC_INTERVAL_S)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RapidRelay Fallback Data Fetcher")
    parser.add_argument("--once",    action="store_true", help="Sync once and exit")
    parser.add_argument("--dry-run", action="store_true", help="Show what would sync, no writes")
    args = parser.parse_args()
    
    if args.once or args.dry_run:
        run_once(dry_run=args.dry_run)
    else:
        run_forever()
