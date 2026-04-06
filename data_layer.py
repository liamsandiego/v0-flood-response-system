"""
data_layer.py — Shared persistence layer for RapidRelay
Raspberry Pi 5 / Ubuntu deployment

Single source of truth: ONE SQLite file shared by:
  - lora_bridge.py  (writes sensor readings)
  - sync_engine.py  (reads/marks synced)
  - FastAPI backend  (reads for dashboard)

All writes go to SQLite unconditionally.
Supabase is a mirror — sync_engine.py handles that separately.

Usage:
    from data_layer import DataLayer
    db = DataLayer()
    db.insert_reading({...})
    db.insert_alert({...})
    db.insert_prediction({...})
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

logger = logging.getLogger("data_layer")

# ---------------------------------------------------------------------------
# Shared DB path — override via LOCAL_DB_PATH env var
# Linux/RPi default: /home/rapidrelay/db/local.db
# Windows dev default: D:/raprelay/db/local.db
# ---------------------------------------------------------------------------
_DEFAULT_PATH = (
    "/home/rapidrelay/db/local.db"
    if os.name != "nt"
    else "D:/raprelay/db/local.db"
)
DB_PATH = Path(os.environ.get("LOCAL_DB_PATH", _DEFAULT_PATH))

# Schema file (drop-in: python data_layer.py to init fresh DB)
_SCHEMA_SQL = Path(__file__).parent / "schema.sql"


# ---------------------------------------------------------------------------
# Core DB helpers
# ---------------------------------------------------------------------------

def get_connection(path: Path | None = None) -> sqlite3.Connection:
    """Open (and create if needed) the SQLite connection with WAL mode."""
    p = path or DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), timeout=10, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA cache_size = -64000")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection, schema_path: Path | None = None) -> None:
    """Create all tables / indexes from schema.sql (idempotent, IF NOT EXISTS)."""
    sp = schema_path or _SCHEMA_SQL
    if sp.exists():
        conn.executescript(sp.read_text(encoding="utf-8"))
    else:
        # Inline minimal schema as fallback (no external file dependency)
        conn.executescript(_INLINE_SCHEMA)
    conn.commit()
    logger.debug("Schema ensured at %s", DB_PATH)


# Inline minimal schema — used if schema.sql is missing (should not happen in prod)
_INLINE_SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS readings_local (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id       TEXT    NOT NULL,
    raw_mm          INTEGER,
    validated_m     REAL,
    uncertainty     REAL,
    alert_level     TEXT    DEFAULT 'CLEAR',
    requires_human  BOOLEAN DEFAULT 0,
    explanation     TEXT,
    constraint_pass BOOLEAN DEFAULT 1,
    constraint_note TEXT,
    source          TEXT    DEFAULT 'lora',
    synced          BOOLEAN DEFAULT 0,
    cloud_id        TEXT,
    created_at      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_readings_sensor   ON readings_local(sensor_id);
CREATE INDEX IF NOT EXISTS idx_readings_created  ON readings_local(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_unsynced ON readings_local(synced) WHERE synced = 0;
CREATE TABLE IF NOT EXISTS alerts_local (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_level     TEXT    NOT NULL,
    title           TEXT,
    message         TEXT    NOT NULL,
    source          TEXT    DEFAULT 'system',
    sensor_id       TEXT,
    reading_id      INTEGER,
    channels_sent   TEXT,
    acknowledged    BOOLEAN DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at DATETIME,
    synced          BOOLEAN DEFAULT 0,
    cloud_id        TEXT,
    created_at      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS predictions_local (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    flood_probability REAL   NOT NULL,
    alert_level      TEXT    NOT NULL,
    features_json    TEXT,
    method           TEXT    DEFAULT 'xgboost',
    model_version    TEXT    DEFAULT 'v1',
    synced           BOOLEAN DEFAULT 0,
    cloud_id         TEXT,
    predicted_at     DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS offline_buffer (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id   TEXT    NOT NULL,
    raw_payload TEXT    NOT NULL,
    source      TEXT    DEFAULT 'lora',
    retry_count INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name  TEXT    NOT NULL,
    record_id   INTEGER NOT NULL,
    operation   TEXT    NOT NULL DEFAULT 'INSERT',
    attempts    INTEGER DEFAULT 0,
    next_retry  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_error  TEXT,
    created_at  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(table_name, record_id)
);
CREATE TABLE IF NOT EXISTS sync_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    direction    TEXT    NOT NULL,
    table_name   TEXT    DEFAULT 'readings_local',
    records      INTEGER DEFAULT 0,
    conflicts    INTEGER DEFAULT 0,
    status       TEXT    NOT NULL,
    error_msg    TEXT,
    duration_ms  INTEGER,
    created_at   DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    source     TEXT DEFAULT 'local',
    updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT OR IGNORE INTO system_config (key, value) VALUES
    ('lora_serial_port', '/dev/ttyUSB0'),
    ('lora_baud_rate',   '115200'),
    ('lora_mode',        'serial'),
    ('sync_interval_s',  '300'),
    ('db_version',       '2');
"""


# ---------------------------------------------------------------------------
# DataLayer — high-level API used by lora_bridge, FastAPI, etc.
# ---------------------------------------------------------------------------

class DataLayer:
    """
    Thread-safe SQLite wrapper. One instance per process, shared across threads.
    Each public method opens a short-lived connection from the pool (SQLite
    handles WAL concurrency natively for multiple readers + one writer).
    """

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or DB_PATH
        # Create and cache a schema-checked connection for the main thread
        self._conn: sqlite3.Connection | None = None

    def _get(self) -> sqlite3.Connection:
        """Return or create the connection for this thread."""
        if self._conn is None:
            self._conn = get_connection(self.db_path)
            ensure_schema(self._conn)
        return self._conn

    @contextmanager
    def _tx(self) -> Generator[sqlite3.Connection, None, None]:
        """Context manager for a write transaction with retry on lock."""
        conn = self._get()
        for attempt in range(5):
            try:
                yield conn
                return
            except sqlite3.OperationalError as e:
                if "locked" in str(e) and attempt < 4:
                    time.sleep(0.1 * (attempt + 1))
                else:
                    raise

    # ------------------------------------------------------------------
    # Readings
    # ------------------------------------------------------------------

    def insert_reading(self, reading: dict[str, Any]) -> int:
        """
        Insert a validated sensor reading. Always synced=0 (pending cloud push).
        Returns the new row ID.
        """
        with self._tx() as conn:
            cur = conn.execute("""
                INSERT INTO readings_local
                    (sensor_id, raw_mm, validated_m, uncertainty, alert_level,
                     requires_human, explanation, constraint_pass, constraint_note, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                reading["sensor_id"],
                reading.get("raw_mm"),
                reading.get("validated_m"),
                reading.get("uncertainty"),
                reading.get("alert_level", "NORMAL"),
                1 if reading.get("requires_human") else 0,
                json.dumps(reading["explanation"]) if reading.get("explanation") else None,
                1 if reading.get("constraint_pass", True) else 0,
                reading.get("constraint_note"),
                reading.get("source", "lora"),
            ))
            conn.commit()
            return cur.lastrowid

    def get_last_reading_mm(self, sensor_id: str) -> int | None:
        conn = self._get()
        row = conn.execute(
            "SELECT raw_mm FROM readings_local WHERE sensor_id=? ORDER BY id DESC LIMIT 1",
            (sensor_id,)
        ).fetchone()
        return row["raw_mm"] if row else None

    def get_recent_readings(self, sensor_id: str, limit: int = 72) -> list[dict]:
        conn = self._get()
        rows = conn.execute(
            "SELECT * FROM readings_local WHERE sensor_id=? ORDER BY id DESC LIMIT ?",
            (sensor_id, limit)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_all_latest_readings(self) -> list[dict]:
        """Return the most recent reading for each sensor (for dashboard)."""
        conn = self._get()
        rows = conn.execute("""
            SELECT r.*
            FROM readings_local r
            INNER JOIN (
                SELECT sensor_id, MAX(id) AS max_id
                FROM readings_local
                GROUP BY sensor_id
            ) latest ON r.id = latest.max_id
            ORDER BY r.sensor_id
        """).fetchall()
        return [dict(r) for r in rows]

    def get_readings_page(
        self,
        sensor_id: str | None = None,
        alert_level: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Paginated readings for dashboard API."""
        conn = self._get()
        where_clauses = []
        params: list[Any] = []
        if sensor_id:
            where_clauses.append("sensor_id = ?")
            params.append(sensor_id)
        if alert_level:
            where_clauses.append("alert_level = ?")
            params.append(alert_level)
        where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        params += [limit, offset]
        rows = conn.execute(
            f"SELECT * FROM readings_local {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params,
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_reading_synced(self, record_id: int, cloud_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE readings_local SET synced=1, cloud_id=? WHERE id=?",
                (cloud_id, record_id)
            )
            conn.commit()

    def get_unsynced_readings(self, limit: int = 100) -> list[dict]:
        conn = self._get()
        rows = conn.execute(
            "SELECT * FROM readings_local WHERE synced=0 ORDER BY id ASC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    def insert_alert(self, alert: dict[str, Any]) -> int:
        with self._tx() as conn:
            cur = conn.execute("""
                INSERT INTO alerts_local
                    (alert_level, title, message, source, sensor_id,
                     reading_id, channels_sent)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                alert["alert_level"],
                alert.get("title"),
                alert["message"],
                alert.get("source", "system"),
                alert.get("sensor_id"),
                alert.get("reading_id"),
                json.dumps(alert["channels_sent"]) if alert.get("channels_sent") else None,
            ))
            conn.commit()
            return cur.lastrowid

    def get_recent_alerts(self, limit: int = 50) -> list[dict]:
        conn = self._get()
        rows = conn.execute(
            "SELECT * FROM alerts_local ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def acknowledge_alert(self, alert_id: int, acknowledged_by: str = "operator") -> None:
        with self._tx() as conn:
            conn.execute("""
                UPDATE alerts_local
                SET acknowledged=1, acknowledged_by=?, acknowledged_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE id=?
            """, (acknowledged_by, alert_id))
            conn.commit()

    def get_unsynced_alerts(self, limit: int = 100) -> list[dict]:
        conn = self._get()
        rows = conn.execute(
            "SELECT * FROM alerts_local WHERE synced=0 ORDER BY id ASC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_alert_synced(self, alert_id: int, cloud_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE alerts_local SET synced=1, cloud_id=? WHERE id=?",
                (cloud_id, alert_id)
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Predictions
    # ------------------------------------------------------------------

    def insert_prediction(self, pred: dict[str, Any]) -> int:
        with self._tx() as conn:
            cur = conn.execute("""
                INSERT INTO predictions_local
                    (flood_probability, alert_level, features_json, method, model_version)
                VALUES (?, ?, ?, ?, ?)
            """, (
                pred["flood_probability"],
                pred["alert_level"],
                json.dumps(pred.get("features_json") or pred.get("features_used")),
                pred.get("method", "xgboost"),
                pred.get("model_version", "v1"),
            ))
            conn.commit()
            return cur.lastrowid

    def get_latest_prediction(self) -> dict | None:
        conn = self._get()
        row = conn.execute(
            "SELECT * FROM predictions_local ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

    def get_unsynced_predictions(self, limit: int = 100) -> list[dict]:
        conn = self._get()
        rows = conn.execute(
            "SELECT * FROM predictions_local WHERE synced=0 ORDER BY id ASC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def mark_prediction_synced(self, pred_id: int, cloud_id: str) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE predictions_local SET synced=1, cloud_id=? WHERE id=?",
                (cloud_id, pred_id)
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Offline buffer
    # ------------------------------------------------------------------

    def buffer_raw_payload(self, sensor_id: str, raw_payload: Any, source: str = "lora") -> int:
        """Store a raw payload when readings_local insert fails (DB busy/locked)."""
        with self._tx() as conn:
            cur = conn.execute(
                "INSERT INTO offline_buffer (sensor_id, raw_payload, source) VALUES (?,?,?)",
                (sensor_id, json.dumps(raw_payload) if not isinstance(raw_payload, str) else raw_payload, source)
            )
            conn.commit()
            return cur.lastrowid

    def drain_offline_buffer(self) -> list[dict]:
        """Return all buffered payloads and delete them. Call this on startup."""
        with self._tx() as conn:
            rows = conn.execute(
                "SELECT * FROM offline_buffer ORDER BY id ASC"
            ).fetchall()
            if rows:
                conn.execute("DELETE FROM offline_buffer WHERE id <= ?", (rows[-1]["id"],))
                conn.commit()
            return [dict(r) for r in rows]

    def purge_old_buffer(self, max_age_hours: int = 24) -> int:
        """Delete buffer entries older than max_age_hours. Returns count deleted."""
        with self._tx() as conn:
            cur = conn.execute(
                "DELETE FROM offline_buffer WHERE created_at < datetime('now', ?)",
                (f"-{max_age_hours} hours",)
            )
            conn.commit()
            return cur.rowcount

    # ------------------------------------------------------------------
    # Sync queue & log
    # ------------------------------------------------------------------

    def queue_retry(self, table_name: str, record_id: int, error: str) -> None:
        """Add a failed record to the sync retry queue with exponential backoff."""
        with self._tx() as conn:
            # Check current attempts for backoff calculation
            row = conn.execute(
                "SELECT attempts FROM sync_queue WHERE table_name=? AND record_id=?",
                (table_name, record_id)
            ).fetchone()
            attempts = (row["attempts"] + 1) if row else 1
            # Exponential backoff: 1min, 2min, 4min, 8min ... capped at 60min
            backoff_minutes = min(2 ** (attempts - 1), 60)
            conn.execute("""
                INSERT INTO sync_queue (table_name, record_id, operation, attempts, next_retry, last_error)
                VALUES (?, ?, 'INSERT', ?, datetime('now', ?), ?)
                ON CONFLICT(table_name, record_id) DO UPDATE SET
                    attempts   = excluded.attempts,
                    next_retry = excluded.next_retry,
                    last_error = excluded.last_error
            """, (table_name, record_id, attempts, f"+{backoff_minutes} minutes", error[:500]))
            conn.commit()

    def get_due_retries(self) -> list[dict]:
        """Return sync_queue entries whose next_retry time has passed."""
        conn = self._get()
        rows = conn.execute(
            "SELECT * FROM sync_queue WHERE next_retry <= datetime('now') ORDER BY created_at ASC LIMIT 200"
        ).fetchall()
        return [dict(r) for r in rows]

    def remove_from_queue(self, table_name: str, record_id: int) -> None:
        with self._tx() as conn:
            conn.execute(
                "DELETE FROM sync_queue WHERE table_name=? AND record_id=?",
                (table_name, record_id)
            )
            conn.commit()

    def log_sync(
        self,
        direction: str,
        table_name: str,
        records: int,
        status: str,
        conflicts: int = 0,
        error_msg: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        with self._tx() as conn:
            conn.execute("""
                INSERT INTO sync_log
                    (direction, table_name, records, conflicts, status, error_msg, duration_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (direction, table_name, records, conflicts, status, error_msg, duration_ms))
            conn.commit()

    def get_sync_status(self) -> dict:
        """Summary for health endpoint / dashboard."""
        conn = self._get()
        unsynced_readings = conn.execute(
            "SELECT COUNT(*) FROM readings_local WHERE synced=0"
        ).fetchone()[0]
        unsynced_alerts = conn.execute(
            "SELECT COUNT(*) FROM alerts_local WHERE synced=0"
        ).fetchone()[0]
        unsynced_preds = conn.execute(
            "SELECT COUNT(*) FROM predictions_local WHERE synced=0"
        ).fetchone()[0]
        queue_size = conn.execute("SELECT COUNT(*) FROM sync_queue").fetchone()[0]
        last_sync = conn.execute(
            "SELECT created_at, status FROM sync_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return {
            "unsynced_readings": unsynced_readings,
            "unsynced_alerts": unsynced_alerts,
            "unsynced_predictions": unsynced_preds,
            "retry_queue_size": queue_size,
            "last_sync_at": last_sync["created_at"] if last_sync else None,
            "last_sync_status": last_sync["status"] if last_sync else None,
        }

    # ------------------------------------------------------------------
    # System config
    # ------------------------------------------------------------------

    def get_config(self, key: str, default: str | None = None) -> str | None:
        conn = self._get()
        row = conn.execute("SELECT value FROM system_config WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set_config(self, key: str, value: str, source: str = "local") -> None:
        with self._tx() as conn:
            conn.execute("""
                INSERT INTO system_config (key, value, source, updated_at)
                VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ON CONFLICT(key) DO UPDATE SET
                    value      = excluded.value,
                    source     = excluded.source,
                    updated_at = excluded.updated_at
            """, (key, value, source))
            conn.commit()

    def get_all_config(self) -> dict[str, str]:
        conn = self._get()
        rows = conn.execute("SELECT key, value FROM system_config").fetchall()
        return {r["key"]: r["value"] for r in rows}

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def cleanup_old_data(self, readings_days: int = 90, log_days: int = 30) -> dict[str, int]:
        """
        Prune old synced readings and sync logs to keep DB size manageable.
        Called periodically by sync_engine.
        """
        with self._tx() as conn:
            r = conn.execute(
                "DELETE FROM readings_local WHERE synced=1 AND created_at < datetime('now', ?)",
                (f"-{readings_days} days",)
            )
            s = conn.execute(
                "DELETE FROM sync_log WHERE created_at < datetime('now', ?)",
                (f"-{log_days} days",)
            )
            p = conn.execute(
                "DELETE FROM predictions_local WHERE synced=1 AND predicted_at < datetime('now', ?)",
                (f"-{log_days} days",)
            )
            conn.commit()
            return {
                "readings_pruned": r.rowcount,
                "sync_logs_pruned": s.rowcount,
                "predictions_pruned": p.rowcount,
            }

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> DataLayer:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Module-level singleton (lazily initialized)
# ---------------------------------------------------------------------------

_default_instance: DataLayer | None = None


def get_db() -> DataLayer:
    """Return the module-level singleton DataLayer. Thread-safe via SQLite WAL."""
    global _default_instance
    if _default_instance is None:
        _default_instance = DataLayer()
        logger.info("DataLayer initialized at %s", _default_instance.db_path)
    return _default_instance


# ---------------------------------------------------------------------------
# CLI: initialize / inspect database
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="RapidRelay DataLayer CLI")
    parser.add_argument("--init", action="store_true", help="Initialize DB schema")
    parser.add_argument("--status", action="store_true", help="Show sync status")
    parser.add_argument("--cleanup", action="store_true", help="Prune old records")
    parser.add_argument("--db", default=None, help="Override DB path")
    args = parser.parse_args()

    if args.db:
        DB_PATH = Path(args.db)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
    db = DataLayer()

    if args.init:
        conn = db._get()  # triggers schema init
        print(f"DB initialized at: {db.db_path}")
        print(f"Tables: {[r[0] for r in conn.execute('SELECT name FROM sqlite_master WHERE type=?', ('table',)).fetchall()]}")
        sys.exit(0)

    if args.status:
        status = db.get_sync_status()
        print("\n=== RapidRelay DB Sync Status ===")
        for k, v in status.items():
            print(f"  {k}: {v}")
        sys.exit(0)

    if args.cleanup:
        result = db.cleanup_old_data()
        print(f"Cleanup complete: {result}")
        sys.exit(0)

    parser.print_help()
