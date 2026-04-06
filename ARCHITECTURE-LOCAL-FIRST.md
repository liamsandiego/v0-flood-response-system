# RapidRelay Local-First Architecture

## Overview

RapidRelay is designed as a **local-first, cloud-confident** system:

- **Primary Storage**: SQLite on Raspberry Pi (always available, survives power loss)
- **Cloud Mirror**: Supabase (sync when available, non-blocking if down)
- **RPi Role**: Acts as an autonomous edge device + cloud gateway

The system continues operating and collecting sensor data **even if**:
- Internet is down
- Supabase is unreachable
- Power is temporarily lost (data persisted on disk)
- Cloud service deletes data (local copy remains)

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ SENSORS (LoRa, MQTT, Simulator)                                  │
│  5 Nodes: paliwas, catanghalan, salambao, hulo, pagasa         │
└────────────────┬────────────────────────────────────────────────┘
                 │ Every 5-10 seconds
                 ▼
        ┌────────────────────┐
        │ lora_bridge.py     │  Reads MQTT or simulates
        │ (MQTT subscriber   │  water level, rainfall, temp, humidity
        │  or data generator)│
        └────────┬───────────┘
                 │ Validate & compute alert_level (rule-based)
                 │ If error: buffer in offline_buffer
                 ▼
    ┌────────────────────────────────────┐
    │ SQLite LOCAL DATABASE              │  ◄─ PRIMARY STORAGE
    │ /home/rapidrelay/db/local.db       │  (RPi disk)
    ├────────────────────────────────────┤
    │ tables:                            │
    │  • readings_local (synced=0/1)     │  sensor readings
    │  • alerts_local (synced=0/1)       │  alert events
    │  • predictions_local (synced=0/1)  │  flood predictions
    │  • offline_buffer                  │  unparseable payloads
    │  • sync_queue                      │  retry logic (exp backoff)
    │  • sync_log                        │  audit trail
    └────────┬──────────────┬────────────┘
             │              │
             │ ALWAYS       │ Every 5 sec
             │ WRITE        │ READ
             │              ▼
             │         ┌──────────────────┐
             │         │ FastAPI Backend  │
             │         │ (port 8001)      │
             │         │                  │
             │         │ • Broadcasts     │  WebSocket → Dashboard
             │         │   readings via   │  (Real-time display)
             │         │   /api/ws        │
             │         │ • HTTP API       │  REST endpoints
             │         │ • Rule-based     │  Flood alert logic
             │         │   predictions    │
             │         └──┬───────────────┘
             │            │
             │            ▼
             │         ┌──────────────────┐
             │         │ Next.js Frontend │
             │         │ (port 3000)      │
             │         │                  │
             │         │ Live dashboard   │
             │         │ (3D Mapbox globe)│
             │         │ + Alerts + Graph │
             │         └──────────────────┘
             │
             │ Every 300s (or on demand)
             │ IF internet available
             │ SYNC_INTERVAL_S = 300s
             ▼
    ┌────────────────────────────────────┐
    │ SUPABASE CLOUD DATABASE            │  ◄─ CLOUD MIRROR
    │ (https://ukwfxnbszwcjekdnvebm.     │  (Persistent backup)
    │  supabase.co)                      │
    ├────────────────────────────────────┤
    │ tables:                            │
    │  • readings_mirror ◄─ readings_    │  FROM readings_local
    │    local (unsynced)                │  (marked synced after)
    │  • alerts ◄─ alerts_local          │
    │  • flood_predictions ◄─ predictions│
    │  • device_metadata                 │  (config, status)
    │  • system_config                   │  (pull quarterly)
    └────────────────────────────────────┘
```

---

## Local Persistence Layers

### Layer 1: `readings_local` — Sensor Data

Every sensor reading is **immediately written to SQLite**:

```sql
CREATE TABLE readings_local (
    id              INTEGER PRIMARY KEY,
    sensor_id       TEXT,          -- "node_paliwas_01" etc
    raw_mm          INTEGER,       -- water level in mm
    validated_m     REAL,          -- validated meter float
    alert_level     TEXT,          -- NORMAL|WATCH|WARNING|EMERGENCY
    explanation     TEXT,          -- JSON with reason
    constraint_pass BOOLEAN,       -- passed validation rules
    synced          BOOLEAN,       -- 0=local-only, 1=posted to Supabase
    cloud_id        TEXT,          -- Supabase record ID (when synced)
    created_at      DATETIME,      -- timestamp (UTC)
);
```

**Key Properties:**
- ✅ Written immediately (blocking write)
- ✅ Survives power loss (WAL mode + PRAGMA synchronous)
- ✅ Tracks sync status (`synced` flag)
- ✅ Indexes on `sensor_id`, `created_at`, `synced` for fast queries
- ✅ Unsynced readings can be queried: `WHERE synced = 0`

---

### Layer 2: `offline_buffer` — Unparseable Payloads

If a sensor payload fails validation (bad data, corrupt JSON, invalid alert level):

```sql
CREATE TABLE offline_buffer (
    id          INTEGER PRIMARY KEY,
    sensor_id   TEXT,              -- which node sent bad data
    raw_payload TEXT,              -- original JSON/bytes
    source      TEXT,              -- "lora" | "mqtt" | "simulator"
    retry_count INTEGER,           -- attempt counter
    created_at  DATETIME,          -- when buffered
);
```

**Purpose:**
- Prevents data loss from temporary parsing errors
- Allows later inspection/debugging
- Can be manually replayed if bug is fixed

**Example Scenario:**
```
17:00:00 lora_bridge receives: {'water_level': 'NaN'}
         → Validation fails (not a number)
         → Inserted to offline_buffer (not discarded)
         → Logged as WARNING
17:00:05 Backend re-checks buffer every 5s
         → Still invalid, retry_count++
17:30:00 Admin fixes parsing bug
         → Can retroactively drain buffer
```

---

### Layer 3: `sync_queue` — Retry Logic with Exponential Backoff

When Supabase sync fails for a record:

```sql
CREATE TABLE sync_queue (
    id          INTEGER PRIMARY KEY,
    table_name  TEXT,              -- "readings_local" | "alerts_local" | ...
    record_id   INTEGER,           -- FK to readings_local.id, alerts_local.id, ...
    operation   TEXT,              -- "INSERT" | "UPDATE" | "DELETE"
    attempts    INTEGER,           -- retry counter
    next_retry  DATETIME,          -- when to try next
    last_error  TEXT,              -- HTTP error / Supabase error message
    created_at  DATETIME,          -- when first attempted
);
```

**Retry Strategy:**
```
Attempt 1: Immediate
Attempt 2: + 5 seconds
Attempt 3: + 25 seconds (5×5)
Attempt 4: + 125 seconds (5×25)
...
Max: 10 attempts before manual intervention
```

**Example Scenario:**
```
17:05:00 [sync_engine] readings: 5 unsynced rows
         → POST to Supabase
         → Network timeout (no internet)
         → Mark all 5 in sync_queue with next_retry=17:05:05

17:05:05 [lora_bridge] (or next sync cycle)
         → Checks sync_queue: 5 waiting
         → Retries with +25s delay
         → Still no internet
         → Updates next_retry=17:05:30

17:05:30 Internet restored
         → Retry succeeds
         → Removed from sync_queue
         → marked synced=1 on original record
```

---

### Layer 4: `sync_log` — Audit Trail

Every sync attempt (success or failure) is logged:

```sql
CREATE TABLE sync_log (
    id              INTEGER PRIMARY KEY,
    table_name      TEXT,          -- what was synced
    record_id       INTEGER,       -- which record
    status          TEXT,          -- "SUCCESS" | "FAILED" | "RETRYING"
    http_status     INTEGER,       -- HTTP response code
    error_message   TEXT,          -- detailed error
    synced_count    INTEGER,       -- batch size
    duration_ms     INTEGER,       -- how long sync took
    attempt_ts      DATETIME,      -- when attempt was made
);
```

**Purpose:**
- Debugging: See which records failed and why
- Monitoring: Track sync health over time
- Compliance: Audit trail of what went to cloud

---

## Sync Engine Workflow

### Daemon: `sync_engine.py` (Runs Every 300 seconds)

```
┌────────────────────────────────────┐
│ sync_engine.py (background daemon) │
│ Wakes up every 300s (5 minutes)    │
└────────────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Internet check              │ ◄─ DNS ping to 1.1.1.1:53
        │ (fast, 3-second timeout)    │    (Cloudflare)
        └────────┬───────────────────┘
                 │
        ┌────────▼───────────┐
        │ Internet available?│
        └────────┬────┬──────┘
                 │    │
            YES  │    │ NO
                 ▼    ▼
         ┌─────────┐  ┌─────────────────┐
         │ SYNC    │  │ OFFLINE MODE    │
         │ records │  │ Skip sync       │
         │ to SUP  │  │ Next check: 5m  │
         │ abase   │  │ Data buffered   │
         └────┬────┘  │ locally         │
              │       └─────────────────┘
              ▼
    ┌──────────────────────────────┐
    │ Connect to Supabase          │
    │ (service role key auth)      │
    └──────────┬───────────────────┘
               │
        ┌──────▼───────────┐
        │ Get unsynced rows│
        │ (BATCH_SIZE=100) │
        │ FROM:            │
        │  • readings_    │
        │    local WHERE  │
        │    synced=0     │
        │  • alerts_local │
        │  • predictions_ │
        │    local        │
        └──────┬──────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ INSERT batch to Supabase     │
    │ readings → readings_mirror   │
    │ alerts → alerts              │
    │ predictions → flood_          │
    │            predictions        │
    └──────┬───────────┬████████████┘
           │           │
      SUCCESS│         │FAILED
           │           │
           ▼           ▼
    ┌──────────┐  ┌─────────────┐
    │ Mark     │  │ Queue retry │
    │ synced=1 │  │ Exp backoff │
    │ Log: ✓   │  │ Log: ✗      │
    └──────────┘  └─────────────┘
```

---

## Power Loss Scenario: What Happens?

### Scenario: RPi loses power during data collection

```
17:30:45 lora_bridge reading sensor #3: water_level=4.2m
         → INSERT to readings_local
         → Disk write via SQLite WAL

17:30:46 ← POWER LOSS ←

[RPi down for 8 hours]

02:10:00 Power restored
         → RPi boots (10 seconds to SSH)
         → All services start via start.sh

02:10:15 lora_bridge resumes
         → Reads unprocessed messages from MQTT broker
         → Continues writing to readings_local

02:10:20 sync_engine wakes up
         → Checks internet (restored)
         → Finds 47 unsynced readings from before power loss
         → Syncs all 47 to Supabase (in batches)

02:10:25 Dashboard comes back online
         → Web clients reconnect
         → See historical data + new readings streamed live
```

**What was NOT lost:**
- ✅ All 47 readings in `readings_local`
- ✅ Alert history in `alerts_local`
- ✅ Predictions in `predictions_local`
- ✅ Raw payloads in `offline_buffer`

**Data Recovery:**
1. RPi disk survives power loss (SQLite WAL mode)
2. Readings are queued in `sync_queue`
3. On next power-up: `sync_engine` drains queue
4. Missing data fully recovers to Supabase

---

## Internet Outage Scenario

### Scenario: LoRa network stays up, Supabase down for 2 hours

```
11:00:00 Supabase goes down (maintenance)
         lora_bridge still running

11:05:00 sync_engine tries sync
         → POST to Supabase: Connection refused
         → Caught exception
         → Queue 5 unsynced readings for retry
         → Log errors
         → Set next_retry = 11:05:30

11:05:30 sync_engine retries
         → Still down
         → Backoff: next_retry = 11:05:55

[Meanwhile, sensors keep working]
11:10:00 52 new readings collected
         → All written to readings_local (synced=0)
         → Dashboard shows them in real-time

12:52:00 Supabase comes back online

12:55:00 Next sync_engine cycle
         → Internet: ✓ available
         → Supabase: ✓ reachable
         → Batch 1: 57 readings from queue
         → Batch 2: remaining readings
         → All marked synced=1

12:56:00 Dashboard data syncs to cloud
         → Historical + new readings appear in Supabase
```

**What happened:**
- ✅ Sensors collected 52 readings
- ✅ Dashboard displayed them in real-time
- ✅ Pending syncs auto-retried
- ✅ Zero data loss
- ✅ Dashboard never went down (local SQLite used)

---

## Supabase Credentials Management

### Why Supabase is Optional

**Root `.env`:**
```env
SUPABASE_URL=https://ukwfxnbszwcjekdnvebm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

**Backend `.env`:**
```env
SUPABASE_URL=https://ukwfxnbszwcjekdnvebm.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...
```

**If not set:**
```python
# In sync_engine.py
if not SUPABASE_URL or not SUPABASE_KEY:
    logger.warning("Supabase not configured — running in local-only mode")
    # skip sync, but system keeps working
```

**Result:** Fully operational flood warning system even without Supabase!

---

## Deployment Checklist: Local-First

- [ ] SQLite database path exists: `/home/rapidrelay/db/local.db` (or Windows equivalent)
- [ ] Disk space: At least 1GB free (100 days of readings ≈ 500MB)
- [ ] WAL mode enabled (automatic in `get_connection()`)
- [ ] Sync interval configured: `SYNC_INTERVAL_S=300` in `.env`
- [ ] Offline buffer emptying: Automated in `lora_bridge.py`
- [ ] Sync queue max attempts: 10 (configurable in `sync_engine.py`)
- [ ] Supabase credentials optional (but recommended for cloud backup)
- [ ] Systemd service configured to auto-start on RPi reboot

---

## Monitoring Commands

### Check local database size:
```bash
ls -lh /home/rapidrelay/db/local.db
du -sh /home/rapidrelay/db/  # Total DB size
```

### Check unsynced data:
```bash
sqlite3 /home/rapidrelay/db/local.db \
  "SELECT COUNT(*) FROM readings_local WHERE synced=0; \
   SELECT COUNT(*) FROM alerts_local WHERE synced=0;"
```

### Check sync queue (pending retries):
```bash
sqlite3 /home/rapidrelay/db/local.db \
  "SELECT table_name, COUNT(*) as pending FROM sync_queue GROUP BY table_name;"
```

### Watch sync engine:
```bash
./start.sh --no-docker --simulate
tail -f logs/sync_engine.log
# Look for: "readings_local: synced X", "FAILED", "next_retry"
```

### Watch API data flow:
```bash
curl http://localhost:8001/  # Check /simulator/node_count and /ws_clients
curl http://localhost:8001/api/readings/status  # If endpoint exists
```

---

## Summary: Why This Architecture Wins

| Scenario | Outcome |
|----------|---------|
| Internet down | ✅ System works, data buffers locally |
| Power loss | ✅ Data on disk survives, recovery automatic |
| Supabase maintenance | ✅ Local dashboard doesn't pause |
| Large data backlog | ✅ Exponential backoff prevents hammering cloud |
| Sensor malfunction | ✅ Bad payloads buffered for debugging |
| RPi disk full | ⚠️ Sync pauses (but readings continue locally) |
| Cloud credentials invalid | ✅ System degrades gracefully, warnings logged |

---

## Future Enhancements

1. **Automatic cleanup**: Delete synced local records after 30 days
2. **Compression**: Archive old readings to reduce disk footprint
3. **Differential sync**: Only send readings since last successful sync
4. **Local replication**: Failover RPi syncs from primary RPi's SQLite
5. **Mobile app**: Offline-first React Native app reading local API
