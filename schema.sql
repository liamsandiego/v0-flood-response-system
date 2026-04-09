-- =============================================================================
-- RapidRelay — SQLite Schema (Local-First, Source of Truth)
-- Obando, Bulacan Flood Early Warning System
-- Raspberry Pi 5 / Ubuntu deployment
--
-- ONE database file, shared by:
--   - lora_bridge.py   (writes sensor readings)
--   - sync_engine.py   (reads unsynced, writes sync status)
--   - FastAPI backend  (reads for dashboard API / WebSocket)
--
-- Default path: $LOCAL_DB_PATH or /home/rapidrelay/db/local.db
-- =============================================================================

-- Performance & Resilience PRAGMAs
PRAGMA journal_mode = WAL;        -- Write-Ahead Logging: survive power loss
PRAGMA synchronous = NORMAL;      -- Balanced durability vs. speed
PRAGMA cache_size = -64000;       -- 64MB page cache
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;       -- keep temp tables in RAM

-- =============================================================================
-- readings_local — PRIMARY data store (LoRa chirps → validated readings)
-- =============================================================================
CREATE TABLE IF NOT EXISTS readings_local (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id       TEXT    NOT NULL,
    raw_mm          INTEGER,                -- raw sensor value in millimeters
    validated_m     REAL,                   -- converted to meters after hard constraints
    uncertainty     REAL,                   -- ensemble variance (0.0 – 1.0)
    alert_level     TEXT    CHECK(alert_level IN ('NORMAL','WATCH','WARNING','EMERGENCY')),
    requires_human  BOOLEAN DEFAULT 0,      -- flagged for manual review
    explanation     TEXT,                   -- Woody (Ollama) JSON output
    -- constraint chain audit
    constraint_pass BOOLEAN DEFAULT 1,      -- passed hard constraint check
    constraint_note TEXT,                   -- reason if flagged/dropped
    -- source tracking
    source          TEXT    DEFAULT 'lora', -- 'lora' | 'mqtt' | 'simulate' | 'manual'
    -- sync tracking
    synced          BOOLEAN DEFAULT 0,
    cloud_id        TEXT,                   -- Supabase UUID, filled on sync
    created_at      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_readings_sensor    ON readings_local(sensor_id);
CREATE INDEX IF NOT EXISTS idx_readings_created   ON readings_local(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_unsynced  ON readings_local(synced) WHERE synced = 0;
CREATE INDEX IF NOT EXISTS idx_readings_alert     ON readings_local(alert_level);

-- =============================================================================
-- alerts_local — Alert records (mirrored to Supabase when online)
-- =============================================================================
CREATE TABLE IF NOT EXISTS alerts_local (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_level     TEXT    NOT NULL CHECK(alert_level IN ('NORMAL','WATCH','WARNING','EMERGENCY')),
    title           TEXT,
    message         TEXT    NOT NULL,
    source          TEXT    DEFAULT 'system',  -- 'system' | 'human' | 'ml' | 'constraint'
    sensor_id       TEXT,                       -- sensor that triggered this (nullable)
    reading_id      INTEGER REFERENCES readings_local(id),
    channels_sent   TEXT,                       -- JSON list of channels notified
    acknowledged    BOOLEAN DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at DATETIME,
    synced          BOOLEAN DEFAULT 0,
    cloud_id        TEXT,
    created_at      DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_created   ON alerts_local(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unsynced  ON alerts_local(synced) WHERE synced = 0;
CREATE INDEX IF NOT EXISTS idx_alerts_level     ON alerts_local(alert_level);

-- =============================================================================
-- predictions_local — ML flood prediction audit trail
-- =============================================================================
CREATE TABLE IF NOT EXISTS predictions_local (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    flood_probability REAL   NOT NULL,
    alert_level      TEXT    NOT NULL CHECK(alert_level IN ('NORMAL','WATCH','WARNING','EMERGENCY')),
    features_json    TEXT,                      -- JSON of feature vector used
    method           TEXT    DEFAULT 'xgboost', -- 'xgboost' | 'ensemble' | 'rule_based'
    model_version    TEXT    DEFAULT 'v1',
    synced           BOOLEAN DEFAULT 0,
    cloud_id         TEXT,
    predicted_at     DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_preds_predicted  ON predictions_local(predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_preds_unsynced   ON predictions_local(synced) WHERE synced = 0;

-- =============================================================================
-- obando_environmental_local — local mirror of cloud environmental table
-- =============================================================================
CREATE TABLE IF NOT EXISTS obando_environmental_local (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    cloud_id           TEXT,
    sensor_id          TEXT,
    soil_moisture      REAL,
    temperature        REAL,
    humidity           REAL,
    pressure           REAL,
    final_distance     REAL,
    record_date        TEXT,
    record_time        TEXT,
    device             TEXT,
    source             TEXT    DEFAULT 'local',
    synced             BOOLEAN DEFAULT 0,
    created_at         DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_env_created    ON obando_environmental_local(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_env_unsynced   ON obando_environmental_local(synced) WHERE synced = 0;
CREATE INDEX IF NOT EXISTS idx_env_cloud_id   ON obando_environmental_local(cloud_id);

-- =============================================================================
-- offline_buffer — ring buffer for readings received when DB is temporarily busy
-- Lora bridge writes here if readings_local insert fails; sync_engine drains it.
-- =============================================================================
CREATE TABLE IF NOT EXISTS offline_buffer (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id   TEXT    NOT NULL,
    raw_payload TEXT    NOT NULL,   -- raw JSON payload as received
    source      TEXT    DEFAULT 'lora',
    retry_count INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Auto-expire buffer entries older than 24h (handled by sync_engine cleanup)
CREATE INDEX IF NOT EXISTS idx_offline_buffer_ts ON offline_buffer(created_at);

-- =============================================================================
-- sync_queue — outbound retry queue for cloud sync
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name  TEXT    NOT NULL CHECK(table_name IN ('readings_local','alerts_local','predictions_local')),
    record_id   INTEGER NOT NULL,
    operation   TEXT    NOT NULL CHECK(operation IN ('INSERT','UPDATE')),
    attempts    INTEGER DEFAULT 0,
    next_retry  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_error  TEXT,
    created_at  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(table_name, record_id)  -- prevent duplicate queue entries
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_retry  ON sync_queue(next_retry);
CREATE INDEX IF NOT EXISTS idx_sync_queue_attempts ON sync_queue(attempts, created_at);

-- =============================================================================
-- sync_log — audit trail for every sync attempt
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    direction    TEXT    NOT NULL CHECK(direction IN ('up','down')),
    table_name   TEXT    DEFAULT 'readings_local',
    records      INTEGER DEFAULT 0,
    conflicts    INTEGER DEFAULT 0,
    status       TEXT    NOT NULL CHECK(status IN ('success','conflict','offline','error','partial')),
    error_msg    TEXT,
    duration_ms  INTEGER,  -- how long the sync took
    created_at   DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_log_created ON sync_log(created_at DESC);

-- =============================================================================
-- system_config — runtime key/value config (editable via dashboard or cloud)
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_config (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    source      TEXT    DEFAULT 'local',  -- 'local' | 'cloud' (cloud wins on conflict)
    updated_at  DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Defaults (INSERT OR IGNORE preserves any existing custom values)
INSERT OR IGNORE INTO system_config (key, value) VALUES
    ('sensor_poll_interval_s',          '5'),
    ('ensemble_uncertainty_threshold',  '0.3'),
    ('hard_constraint_max_mm',          '10000'),
    ('hard_constraint_delta_mm',        '500'),
    ('ollama_model',                    'llama3.2:3b'),
    ('alert_watch_m',                   '1.5'),
    ('alert_warning_m',                 '2.0'),
    ('alert_emergency_m',               '3.0'),
    ('sync_interval_s',                 '300'),
    ('sync_batch_size',                 '100'),
    ('lora_serial_port',                '/dev/ttyUSB0'),
    ('lora_baud_rate',                  '115200'),
    ('lora_mode',                       'serial'),   -- 'serial' | 'mqtt'
    ('mqtt_broker',                     'localhost'),
    ('mqtt_port',                       '1883'),
    ('mqtt_topic',                      'application/+/device/+/event/up'),
    ('offline_buffer_max_age_h',        '24'),
    ('db_version',                      '2');        -- bump when schema changes
