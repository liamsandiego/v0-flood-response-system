# RapidRelay Raspberry Pi 5 Deployment Guide

## Overview

RapidRelay is a **local-first** flood early warning system designed to run on Raspberry Pi 5. The system consists of:

- **Frontend**: Next.js 15 dashboard (port 3000) with real-time 3D Mapbox globe and alerts
- **Backend**: FastAPI server (port 8001) with ML predictions and WebSocket streaming
- **Storage**: SQLite (primary) + optional Supabase cloud sync
- **AI**: Local Ollama LLM + Groq API for interpretations
- **Sensors**: LoRa network via ChirpStack/MQTT or simulated data
- **Alerts**: Rule-based flood prediction (water level + EO indices)

## Prerequisites

✅ Installed by `install.sh`:
- Python 3.9+
- Node.js 18+
- FastAPI, uvicorn, SQLAlchemy, lightgbm, xgboost
- Next.js 15, React, Mapbox GL JS
- Docker (optional, for ChirpStack)

✅ Environment files created:
- `/home/grouptba/RapidRelay/.env` — Root config (LoRa, ML, Supabase)
- `/home/grouptba/RapidRelay/backend/.env` — Backend config (API keys)
- `/home/grouptba/RapidRelay/v0-flood-response-system/.env.local` — Frontend config

## Quick Start

### 1. Start All Services

```bash
cd /home/grouptba/RapidRelay
./start.sh
```

**What this does:**
1. Activates Python virtual environment
2. Starts ChirpStack stack (Docker) — optional, add `--no-docker` to skip
3. Initializes SQLite database
4. Starts LoRa bridge (MQTT or simulated)
5. Starts sync engine (SQLite → Supabase)
6. Starts FastAPI backend on port 8001
7. Starts Next.js dashboard on port 3000
8. Verifies all services are running

**Access the dashboard:**
- http://localhost:3000 (browser)
- http://localhost:8001 (API)
- http://localhost:8080 (ChirpStack, if running)

### 2. Start Without Docker (ChirpStack already running)

```bash
./start.sh --no-docker
```

### 3. Start in Simulation Mode (No Sensor Hardware Needed)

```bash
./start.sh --simulate
```

This generates synthetic sensor data instead of connecting to MQTT. Ideal for initial testing.

### 4. Stop All Services

```bash
./kill.sh
```

## Environment Configuration

### Root `.env` — System Configuration

```
# Database
LOCAL_DB_PATH=/home/rapidrelay/db/local.db

# LoRa Mode
LORA_MODE=mqtt          # or 'simulate' for testing
MQTT_BROKER=localhost
MQTT_PORT=1883

# Sync to Supabase
SYNC_INTERVAL_S=300

# Supabase Keys (cloud sync)
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...

# LLM
GROQ_API_KEY=...
OLLAMA_URL=http://localhost:11434
```

### Backend `.env` — FastAPI Configuration

**Required:**
```
SUPABASE_URL=https://ukwfxnbszwcjekdnvebm.supabase.co
SUPABASE_SERVICE_KEY=eyJh...
GROQ_API_KEY=gsk_...
```

**Optional:**
```
WS_BROADCAST_INTERVAL=5.0
PREDICTION_INTERVAL=300
CORS_ORIGINS=http://localhost:3000
```

### Frontend `.env.local` — Next.js Configuration

```
NEXT_PUBLIC_LOCAL_MODE=true
LOCAL_MODE=true
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_WS_URL=ws://localhost:8001/api/ws
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ...
NEXT_TELEMETRY_DISABLED=1
```

## Monitoring & Debugging

### View Logs

```bash
# All logs
tail -f logs/backend.log
tail -f logs/frontend.log
tail -f logs/lora_bridge.log
tail -f logs/sync_engine.log

# Follow all at once
tail -f logs/*.log
```

### Check Service Status

```bash
# Backend API
curl http://localhost:8001

# WebSocket
wscat -c ws://localhost:8001/api/ws

# Frontend
curl http://localhost:3000

# Database
python data_layer.py --status
```

### Common Issues

**Backend fails to start:**
- Check `logs/backend.log`
- Verify `backend/.env` exists with valid Supabase keys
- Ensure port 8001 is not in use: `lsof -i :8001`

**Frontend won't compile:**
- Clear npm cache: `cd v0-flood-response-system && npm cache clean --force`
- Reinstall deps: `rm -rf node_modules && npm install`
- Check `logs/frontend.log` for errors

**MQTT connection fails:**
- Ensure ChirpStack is running: `docker compose ps`
- Check MQTT broker: `netstat -an | grep 1883`
- Or use simulation mode: `./start.sh --simulate`

**No sensor data appearing:**
- Verify LoRa mode in `.env`: `LORA_MODE=mqtt` (or `simulate`)
- Check `logs/lora_bridge.log`
- Test with `./start.sh --simulate` first

**Supabase not syncing:**
- Check `logs/sync_engine.log`
- Verify credentials in `backend/.env`
- Cloud sync is **optional** — system works offline with SQLite

## Data Flow

```
ChirpStack/MQTT
       ↓
lora_bridge.py (reads sensor data)
       ↓
SQLite (LOCAL_DB_PATH)  ← PRIMARY STORAGE
       ↓                ↓
Backend (FastAPI)    sync_engine.py
       ↓                   ↓
WebSocket Stream      Supabase (optional)
       ↓
Frontend (Next.js)
       ↓
Dashboard (http://localhost:3000)
```

## Architecture: Local-First with Cloud Sync

RapidRelay is designed as a **local-first, cloud-confident** system:

1. **Primary Storage**: SQLite on RPi (always available, survives power loss)
   - Every sensor reading written immediately
   - Readings marked `synced=0` until cloud push succeeds

2. **Cloud Mirror**: Supabase (optional, sync when available)
   - Background sync every 5 minutes (configurable)
   - Non-blocking if cloud is down
   - Exponential backoff retry logic

3. **System Resilience**:
   - ✅ Continues operating without internet
   - ✅ Data survives power loss (SQLite WAL mode)
   - ✅ Supabase is optional (system works offline)
   - ✅ Auto-recovery when power/internet restored

**Data Flow:**
```
Sensors → lora_bridge → SQLite (local) → sync_engine → Supabase (cloud)
                           ↓                                ↓
                      Dashboard API ◄────────────────────────
```

For detailed architecture, see [ARCHITECTURE-LOCAL-FIRST.md](ARCHITECTURE-LOCAL-FIRST.md)

---

## Data Persistence Strategy

### Local Database (SQLite)

**Location**: `/home/rapidrelay/db/local.db` (Linux/RPi) or `D:/raprelay/db/local.db` (Windows)

**Tables**:
- `readings_local` — sensor data with `synced` flag (0=local-only, 1=uploaded)
- `alerts_local` — flood alerts with sync status
- `predictions_local` — rule-based predictions
- `offline_buffer` — unparseable payloads (for debugging network issues)
- `sync_queue` — retry queue with exponential backoff (if Supabase fails)
- `sync_log` — audit trail of all sync attempts

**Key Features**:
- ✅ WAL mode (Write-Ahead Logging) — survives power loss without data corruption
- ✅ PRAGMA synchronous=NORMAL — fast writes that still survive crashes
- ✅ Foreign keys enabled — data integrity constraints
- ✅ Indexes on sensor_id, created_at, synced — fast queries for sync and dashboard

### Sync Engine (`sync_engine.py`) — Cloud Backup

**Purpose**: Periodically pushes local data to Supabase (optional, non-blocking)

**Schedule**: Every 300 seconds (5 minutes) by default
**Configurable**: `SYNC_INTERVAL_S=300` in `.env`

**Process**:
1. Check internet connectivity (DNS ping to 1.1.1.1:53)
2. If online: batch push unsynced readings to Supabase
3. Mark local records `synced=1` on success
4. If offline: skip sync, try again after 5 minutes

**Retry Logic** (Exponential Backoff):
- Attempt 1: Immediate
- Attempt 2: +5 seconds
- Attempt 3: +25 seconds
- Attempt 4+: Exponential backoff (max 10 attempts before manual review)

**Monitoring Sync Status**:
```bash
tail -f logs/sync_engine.log
# Examples:
# readings_local: 12 unsynced rows to push
# readings_mirror batch insert succeeded: synced 12
# FAILED: connection refused — queued for retry
# next sync in 300s
```

### Power Loss Recovery

When RPi loses power **mid-operation**:

1. **Data Safety**: SQLite on disk is safe (WAL mode preserves uncommitted data)
2. **Recovery**: On next boot, readings marked `synced=0` are still in database
3. **Auto-Sync**: `sync_engine` automatically retries on startup
4. **Result**: No data loss, cloud backup complete when power returns

### Internet Outage Recovery

When internet goes down **while system running**:

1. **Local System**: Continues operating at 100% capacity
2. **Sensor Collection**: All readings written to SQLite (unaffected by cloud)
3. **Dashboard**: Shows real-time data from SQLite (doesn't pause)
4. **Cloud Sync**: Paused (logged as "OFFLINE"), auto-resumes when internet returns
5. **Data Buffering**: Pending syncs automatically retry with backoff

**Example**: 2-hour outage with 500 sensor readings collected
- All 500 stored locally with `synced=0`
- Dashboard displays all 500 in real-time
- When internet restored, all 500 pushed to Supabase in batches
- Zero data loss, zero dashboard downtime

### Optional: Disable Cloud Sync

If you want local-only mode (no Supabase):

```bash
# Comment out in .env:
# NEXT_PUBLIC_SUPABASE_URL=...
# SUPABASE_SERVICE_KEY=...

# Or set to empty:
SUPABASE_URL=""
```

**Result**: System works perfectly without Supabase
- Readings still stored in SQLite
- Dashboard still shows all data in real-time
- No cloud backup (data only on RPi disk)

---

## Flood Predictions

The system uses **rule-based flood prediction** without external ML models:

- **Algorithm**: Water level + Earth Observation indices with weighted sensor fusion
- **Features**:
  - Real-time water level measurements from LoRa sensors
  - Rainfall data integration
  - Historical thresholds from Obando floods
- **Output**: Alert levels (NORMAL/WATCH/WARNING/EMERGENCY) displayed on dashboard
- **Advantages**: Works offline, no external dependencies, low latency, transparent logic

No machine learning models required. The system predicts flood risk based on proven hydro-meteorological rules.


## Deployment on Actual Raspberry Pi 5

### Hardware Checklist

- [ ] Raspberry Pi 5 with 8GB+ RAM
- [ ] 64GB+ microSD card (or USB SSD)
- [ ] Power supply (27W+ USB-C PD)
- [ ] Network connection (WiFi or Ethernet)
- [ ] LoRa gateway (ChirpStack) or simulation mode
- [ ] Optional: HDMI monitor, keyboard for initial setup

### Steps

1. **Clone repo on RPi:**
   ```bash
   cd ~
   git clone https://github.com/your-org/RapidRelay.git
   cd RapidRelay
   ```

2. **Run install script:**
   ```bash
   chmod +x install.sh
   ./install.sh
   # Takes 20-30 min on RPi
   ```

3. **Add environment files:**
   ```bash
   # Copy .env files from secure location or use .env.example
   cp .env.example .env
   # Edit with your Supabase/Groq keys
   nano .env

   cp backend/.env.example backend/.env
   nano backend/.env

   cp v0-flood-response-system/.env.example v0-flood-response-system/.env.local
   nano v0-flood-response-system/.env.local
   ```

4. **Start services:**
   ```bash
   ./start.sh --simulate  # First test with simulation
   # Visit http://<rpi-ip>:3000 from another device
   ```

5. **Enable systemd service (optional, for auto-start):**
   ```bash
   sudo cp rapidrelay.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable rapidrelay
   sudo systemctl start rapidrelay
   ```

## Testing

### Unit Tests

```bash
cd backend
pytest tests/
```

### Integration Test

```bash
./start.sh --simulate
# Wait 30 seconds for services to start
curl -s http://localhost:8001 | jq .
wscat -c ws://localhost:8001/api/ws
# Observe real-time sensor data and predictions
```

### End-to-End Test

1. Start dashboard: http://localhost:3000
2. Verify real-time updates from WebSocket
3. Check database: `python data_layer.py --status`
4. Trigger alert in simulator and verify on dashboard

## File Structure

```
RapidRelay/
├── backend/                    # FastAPI server
│   ├── app/
│   │   ├── main.py            # FastAPI app + sensor loop
│   │   ├── config.py          # Configuration loading
│   │   ├── database.py        # SQLite ORM
│   │   ├── supabase_client.py # Cloud integration
│   │   ├── services/          # Prediction, simulator, etc.
│   │   └── routers/           # API endpoints + WebSocket
│   ├── requirements.txt
│   └── .env                   # Backend config (created)
├── v0-flood-response-system/   # Next.js frontend
│   ├── app/
│   ├── components/
│   ├── package.json
│   └── .env.local             # Frontend config (created)
├── start.sh                    # Start all services
├── kill.sh                     # Stop all services
├── data_layer.py              # Database initialization
├── lora_bridge.py             # MQTT sensor integration
├── sync_engine.py             # Supabase sync
├── .env                       # Root config (created)
└── logs/                      # Service logs
```

## Support

- **Issues**: Check `logs/` folder for detailed error messages
- **Documentation**: See README.md for architecture details
- **Troubleshooting**: Reference section above in this guide
