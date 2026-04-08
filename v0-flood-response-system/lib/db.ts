/**
 * lib/db.ts — Singleton better-sqlite3 connection
 * 
 * Server-only. Import only in Next.js Route Handlers (app/api/).
 * Never import in client components or pages.
 * 
 * On first open: applies WAL pragma and initializes schema tables.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_PATH =
  process.env.LOCAL_DB_PATH ||
  path.join(process.cwd(), "local.db");

// ---------------------------------------------------------------------------
// Schema bootstrap (inline — avoids reading external .sql file at runtime)
// ---------------------------------------------------------------------------
const BOOTSTRAP_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -32000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS readings_local (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id       TEXT    NOT NULL,
  raw_mm          INTEGER,
  validated_m     REAL,
  uncertainty     REAL,
  alert_level     TEXT    DEFAULT 'NORMAL',
  requires_human  INTEGER DEFAULT 0,
  explanation     TEXT,
  constraint_pass INTEGER DEFAULT 1,
  constraint_note TEXT,
  synced          INTEGER DEFAULT 0,
  cloud_id        TEXT,
  created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_readings_sensor  ON readings_local(sensor_id);
CREATE INDEX IF NOT EXISTS idx_readings_created ON readings_local(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_unsynced ON readings_local(synced) WHERE synced = 0;

CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT    NOT NULL,
  record_id   INTEGER NOT NULL,
  operation   TEXT    NOT NULL DEFAULT 'INSERT',
  attempts    INTEGER DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  direction   TEXT    NOT NULL DEFAULT 'up',
  records     INTEGER DEFAULT 0,
  conflicts   INTEGER DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'success',
  error_msg   TEXT,
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO system_config (key, value) VALUES
  ('alert_watch_m', '1.5'),
  ('alert_warning_m', '2.0'),
  ('alert_emergency_m', '3.0'),
  ('ensemble_uncertainty_threshold', '0.3'),
  ('ollama_model', 'llama3.2:3b');
`;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure parent directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH, {
    // verbose: process.env.NODE_ENV === "development" ? console.log : undefined,
  });

  // Bootstrap schema
  _db.exec(BOOTSTRAP_SQL);

  return _db;
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
export interface LocalReading {
  id: number;
  sensor_id: string;
  raw_mm: number | null;
  validated_m: number | null;
  uncertainty: number | null;
  alert_level: "NORMAL" | "WATCH" | "WARNING" | "EMERGENCY";
  requires_human: number; // SQLite stores booleans as 0/1
  explanation: string | null; // JSON string
  constraint_pass: number;
  constraint_note: string | null;
  synced: number;
  cloud_id: string | null;
  created_at: string;
}

export interface SyncStatus {
  unsynced_count: number;
  last_sync: SyncLogEntry | null;
}

export interface SyncLogEntry {
  id: number;
  direction: string;
  records: number;
  conflicts: number;
  status: string;
  error_msg: string | null;
  created_at: string;
}
