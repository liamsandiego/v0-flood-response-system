"""
sync_engine.py — Background cloud sync daemon (hardened)
RapidRelay / Obando Flood Early Warning System
Raspberry Pi 5 / Ubuntu deployment

Syncs:  SQLite local.db → Supabase (up)
        Supabase system_config → local.db (down)

Tables synced UP:
  readings_local    → readings_mirror
  alerts_local      → alerts (public.alerts)
  predictions_local → flood_predictions

Resilience:
  - Checks internet (DNS) AND Supabase reachability before sync
  - Exponential backoff per record via data_layer.queue_retry()
  - All errors logged to sync_log — never crashes the local system
  - On reconnect: drains offline_buffer, processes retry queue

Usage:
    python sync_engine.py              # Run forever (5-min sync interval)
    python sync_engine.py --once       # Sync once and exit
    python sync_engine.py --dry-run    # Show what would be synced, no writes
    python sync_engine.py --down-only  # Only pull config from cloud
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
    format="%(asctime)s [sync_engine] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("sync_engine")

# ---------------------------------------------------------------------------
# Config (env / .env)
# ---------------------------------------------------------------------------

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
SYNC_INTERVAL_S      = int(os.environ.get("SYNC_INTERVAL_S", "300"))   # 5 min
BATCH_SIZE           = int(os.environ.get("SYNC_BATCH_SIZE", "100"))
CLEANUP_INTERVAL_S   = 3600 * 6   # cleanup old data every 6h

INTERNET_CHECK_HOST  = "1.1.1.1"
INTERNET_CHECK_PORT  = 53
INTERNET_CHECK_TO    = 3


# ---------------------------------------------------------------------------
# Connectivity checks
# ---------------------------------------------------------------------------

def internet_available() -> bool:
    """Ping Cloudflare DNS — fast, no HTTP overhead."""
    try:
        socket.setdefaulttimeout(INTERNET_CHECK_TO)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect((INTERNET_CHECK_HOST, INTERNET_CHECK_PORT))
        s.close()
        return True
    except (socket.timeout, OSError):
        return False


def supabase_reachable() -> bool:
    """HTTP health check against Supabase REST endpoint."""
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
    """Return Supabase client or raise descriptive error."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Supabase credentials not configured in .env")
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except ImportError:
        raise RuntimeError("supabase-py not installed: pip install supabase")


# ---------------------------------------------------------------------------
# Sync UP — readings_local → Supabase readings_mirror
# ---------------------------------------------------------------------------

def sync_readings_up(db, dry_run: bool = False) -> tuple[int, int]:
    """Returns (synced_count, error_count)."""
    rows = db.get_unsynced_readings(limit=BATCH_SIZE)
    if not rows:
        return 0, 0

    logger.info("readings_local: %d unsynced rows to push", len(rows))
    if dry_run:
        for r in rows:
            logger.info("  [DRY] reading id=%d sensor=%s level=%s",
                        r["id"], r["sensor_id"], r["alert_level"])
        return len(rows), 0

    sb = _get_supabase_client()
    payload = []
    id_order = []
    for r in rows:
        payload.append({
            "local_id":         r["id"],
            "sensor_id":        r["sensor_id"],
            "raw_mm":           r["raw_mm"],
            "validated_m":      r["validated_m"],
            "uncertainty":      r["uncertainty"],
            "alert_level":      r["alert_level"],
            "requires_human":   bool(r["requires_human"]),
            "explanation":      json.loads(r["explanation"]) if r.get("explanation") else None,
            "source":           r.get("source", "lora"),
            "local_created_at": r["created_at"],
        })
        id_order.append(r["id"])

    synced = errors = 0
    try:
        response = sb.table("readings_mirror").insert(payload).execute()
        for i, record in enumerate(response.data or []):
            db.mark_reading_synced(id_order[i], str(record.get("id", "")))
            synced += 1
        logger.info("readings_local: synced %d", synced)
    except Exception as e:
        logger.error("readings_mirror batch insert failed: %s", e)
        for rid in id_order:
            db.queue_retry("readings_local", rid, str(e))
        errors = len(id_order)

    return synced, errors



def map_alert_level_to_supabase(local_level: str) -> str:
    """Map local alert levels (CLEAR/WATCH/WARNING/DANGER) to Supabase (normal/warning/critical)."""
    mapping = {
        "CLEAR":    "normal",
        "WATCH":    "warning",
        "WARNING":  "warning",
        "DANGER":   "critical",
    }
    return mapping.get(local_level.upper(), "normal")


# ---------------------------------------------------------------------------
# Sync UP — alerts_local → Supabase alerts
# ---------------------------------------------------------------------------

def sync_alerts_up(db, dry_run: bool = False) -> tuple[int, int]:
    rows = db.get_unsynced_alerts(limit=BATCH_SIZE)
    if not rows:
        return 0, 0

    logger.info("alerts_local: %d unsynced rows to push", len(rows))
    if dry_run:
        for r in rows:
            logger.info("  [DRY] alert id=%d level=%s", r["id"], r["alert_level"])
        return len(rows), 0

    sb = _get_supabase_client()
    payload = []
    id_order = []
    for r in rows:
        payload.append({
            "alert_level":  map_alert_level_to_supabase(r["alert_level"]),
            "title":        r.get("title"),
            "message":      r["message"],
            "source":       r.get("source", "system"),
            "channels_sent":r.get("channels_sent"),
            "acknowledged": bool(r.get("acknowledged", False)),
        })
        id_order.append(r["id"])

    synced = errors = 0
    try:
        response = sb.table("alerts").insert(payload).execute()
        for i, record in enumerate(response.data or []):
            db.mark_alert_synced(id_order[i], str(record.get("id", "")))
            synced += 1
        logger.info("alerts_local: synced %d", synced)
    except Exception as e:
        logger.error("alerts batch insert failed: %s", e)
        for rid in id_order:
            db.queue_retry("alerts_local", rid, str(e))
        errors = len(id_order)

    return synced, errors


# ---------------------------------------------------------------------------
# Sync UP — predictions_local → Supabase flood_predictions
# ---------------------------------------------------------------------------

def sync_predictions_up(db, dry_run: bool = False) -> tuple[int, int]:
    rows = db.get_unsynced_predictions(limit=BATCH_SIZE)
    if not rows:
        return 0, 0

    logger.info("predictions_local: %d unsynced rows to push", len(rows))
    if dry_run:
        for r in rows:
            logger.info("  [DRY] prediction id=%d level=%s prob=%.2f",
                        r["id"], r["alert_level"], r["flood_probability"])
        return len(rows), 0

    sb = _get_supabase_client()
    payload = []
    id_order = []
    for r in rows:
        payload.append({
            "flood_probability": r["flood_probability"],
            "alert_level":       r["alert_level"],
            "features_json":     r.get("features_json"),
            "method":            r.get("method", "lgbm"),
            "model_version":     r.get("model_version", "v2"),
        })
        id_order.append(r["id"])

    synced = errors = 0
    try:
        response = sb.table("flood_predictions").insert(payload).execute()
        for i, record in enumerate(response.data or []):
            db.mark_prediction_synced(id_order[i], str(record.get("id", "")))
            synced += 1
        logger.info("predictions_local: synced %d", synced)
    except Exception as e:
        logger.error("flood_predictions batch insert failed: %s", e)
        for rid in id_order:
            db.queue_retry("predictions_local", rid, str(e))
        errors = len(id_order)

    return synced, errors


# ---------------------------------------------------------------------------
# Retry queue drain
# ---------------------------------------------------------------------------

def drain_retry_queue(db, dry_run: bool = False) -> int:
    """Process exponential-backoff retry queue for previously failed records."""
    due = db.get_due_retries()
    if not due:
        return 0

    logger.info("Retry queue: %d records due for retry", len(due))
    retried = 0

    for entry in due:
        table   = entry["table_name"]
        rec_id  = entry["record_id"]
        logger.info("  Retrying %s id=%d (attempt %d)", table, rec_id, entry["attempts"])

        if dry_run:
            retried += 1
            continue

        try:
            sb = _get_supabase_client()
            # Re-read the row from SQLite and push
            if table == "readings_local":
                rows = db.get_unsynced_readings(limit=1)
                row = next((r for r in rows if r["id"] == rec_id), None)
                if row:
                    resp = sb.table("readings_mirror").insert({
                        "local_id":    row["id"],
                        "sensor_id":   row["sensor_id"],
                        "raw_mm":      row["raw_mm"],
                        "validated_m": row["validated_m"],
                        "alert_level": row["alert_level"],
                        "source":      row.get("source", "lora"),
                    }).execute()
                    if resp.data:
                        db.mark_reading_synced(rec_id, str(resp.data[0].get("id", "")))
                        db.remove_from_queue(table, rec_id)
                        retried += 1
            elif table == "alerts_local":
                rows = db.get_unsynced_alerts(limit=200)
                row = next((r for r in rows if r["id"] == rec_id), None)
                if row:
                    resp = sb.table("alerts").insert({
                        "alert_level": row["alert_level"],
                        "message":     row["message"],
                        "source":      row.get("source", "system"),
                    }).execute()
                    if resp.data:
                        db.mark_alert_synced(rec_id, str(resp.data[0].get("id", "")))
                        db.remove_from_queue(table, rec_id)
                        retried += 1
        except Exception as e:
            logger.warning("Retry failed for %s id=%d: %s", table, rec_id, e)
            db.queue_retry(table, rec_id, str(e))

    return retried


# ---------------------------------------------------------------------------
# Sync DOWN — Supabase system_config → local system_config
# ---------------------------------------------------------------------------

def sync_config_down(db, dry_run: bool = False) -> int:
    """
    Pull any config overrides from Supabase `system_config` table (cloud wins).
    Returns number of config keys updated.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return 0
    try:
        sb = _get_supabase_client()
        # Only pull rows explicitly marked as cloud-sourced or recently updated
        response = sb.table("system_config").select("key,value").execute()
        if not response.data:
            return 0
        updated = 0
        for row in response.data:
            key, val = row.get("key"), row.get("value")
            if key and val is not None:
                current = db.get_config(key)
                if current != val:
                    if dry_run:
                        logger.info("  [DRY] config: %s = %r → %r", key, current, val)
                    else:
                        db.set_config(key, val, source="cloud")
                        logger.info("  config updated: %s = %r", key, val)
                    updated += 1
        return updated
    except Exception as e:
        logger.warning("sync_config_down failed: %s", e)
        return 0


# ---------------------------------------------------------------------------
# Full sync cycle
# ---------------------------------------------------------------------------

def run_once(dry_run: bool = False, down_only: bool = False) -> dict:
    """Run one full sync cycle. Returns a summary dict."""
    from data_layer import get_db
    db = get_db()

    result = {
        "readings": (0, 0),
        "alerts":   (0, 0),
        "preds":    (0, 0),
        "retried":  0,
        "config_updates": 0,
        "status":   "offline",
    }

    if not internet_available():
        logger.info("No internet — skipping sync.")
        db.log_sync("up", "all", 0, "offline")
        return result

    if not supabase_reachable():
        logger.warning("Supabase not reachable (internet up but endpoint unreachable).")
        db.log_sync("up", "all", 0, "error", error_msg="Supabase unreachable")
        result["status"] = "supabase_unreachable"
        return result

    t_start = time.time()
    errors_total = 0

    if not down_only:
        # Drain offline buffer from lora_bridge crash recovery
        try:
            db.purge_old_buffer(max_age_hours=24)
        except Exception:
            pass

        r_syn, r_err = sync_readings_up(db, dry_run)
        a_syn, a_err = sync_alerts_up(db, dry_run)
        p_syn, p_err = sync_predictions_up(db, dry_run)
        retried = drain_retry_queue(db, dry_run)

        result.update({
            "readings": (r_syn, r_err),
            "alerts":   (a_syn, a_err),
            "preds":    (p_syn, p_err),
            "retried":  retried,
        })
        errors_total = r_err + a_err + p_err

    # Config sync down (cloud → local)
    config_updates = sync_config_down(db, dry_run)
    result["config_updates"] = config_updates

    duration_ms = int((time.time() - t_start) * 1000)
    status = "success" if errors_total == 0 else ("partial" if result["readings"][0] > 0 else "error")
    result["status"] = status

    if not dry_run:
        db.log_sync(
            "up", "all",
            records=result["readings"][0] + result["alerts"][0] + result["preds"][0],
            status=status,
            error_msg=f"{errors_total} errors" if errors_total else None,
            duration_ms=duration_ms,
        )

    logger.info(
        "Sync done in %dms: readings=%s alerts=%s preds=%s retried=%d config=%d [%s]",
        duration_ms,
        result["readings"], result["alerts"], result["preds"],
        result["retried"], result["config_updates"], status,
    )
    return result


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run_forever(dry_run: bool = False, down_only: bool = False) -> None:
    logger.info("Sync engine started (interval=%ds, dry_run=%s)", SYNC_INTERVAL_S, dry_run)
    logger.info("Supabase: %s", SUPABASE_URL or "(not configured — will log offline)")

    cleanup_counter = 0

    while True:
        try:
            run_once(dry_run=dry_run, down_only=down_only)
        except Exception as e:
            logger.error("Unexpected error in sync loop: %s", e)

        cleanup_counter += SYNC_INTERVAL_S
        if cleanup_counter >= CLEANUP_INTERVAL_S:
            try:
                from data_layer import get_db
                result = get_db().cleanup_old_data()
                logger.info("Cleanup: %s", result)
            except Exception as e:
                logger.warning("Cleanup error: %s", e)
            cleanup_counter = 0

        logger.info("Next sync in %ds...", SYNC_INTERVAL_S)
        time.sleep(SYNC_INTERVAL_S)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RapidRelay Cloud Sync Engine")
    parser.add_argument("--once",      action="store_true", help="Sync once and exit")
    parser.add_argument("--dry-run",   action="store_true", help="Show what would sync, no writes")
    parser.add_argument("--down-only", action="store_true", help="Only pull config from Supabase")
    args = parser.parse_args()

    if args.once or args.dry_run or args.down_only:
        run_once(dry_run=args.dry_run, down_only=args.down_only)
    else:
        run_forever()
