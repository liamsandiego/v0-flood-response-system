#!/bin/bash
# =============================================================================
# RapidRelay — Start All Services (Raspberry Pi 5 / Ubuntu)
# Replaces: start.bat (Windows)
#
# Services started:
#   1. ChirpStack stack (Docker: postgres, redis, mosquitto, gateway-bridge, chirpstack)
#   2. lora_bridge.py  — LoRa → SQLite pipeline (MQTT mode)
#   3. sync_engine.py  — local SQLite → Supabase sync
#   4. FastAPI backend  (port 8001)
#   5. Next.js dashboard (port 3000)
#
# Usage:
#   ./start.sh              # start everything
#   ./start.sh --no-docker  # skip ChirpStack (already running)
#   ./start.sh --simulate   # use simulated LoRa data (no hardware)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="/tmp/rapidrelay"
LOG_DIR="$ROOT/logs"
VENV=""
WEB_DIR="$ROOT"
CHIRPSTACK_DIR="$ROOT/chirpstack"
FRONTEND_ENABLED=false

# Parse flags
NO_DOCKER=false
SIMULATE=false
for arg in "$@"; do
  case $arg in
    --no-docker) NO_DOCKER=true ;;
    --simulate)  SIMULATE=true  ;;
  esac
done

# Load .env if present
[ -f "$ROOT/.env" ] && set -a && source "$ROOT/.env" && set +a

# Local-first persistence default path on Raspberry Pi
export LOCAL_DB_PATH="${LOCAL_DB_PATH:-/home/rapidrelay/db/local.db}"

mkdir -p "$PID_DIR" "$LOG_DIR"

echo "========================================================"
echo "  RapidRelay — Obando Flood Early Warning System"
echo "  Starting services on Raspberry Pi 5..."
echo "========================================================"

# ── Activate Python venv ──────────────────────────────────────────────────────
if [ -d "$ROOT/.venv" ]; then
  VENV="$ROOT/.venv"
elif [ -d "$ROOT/.venv311" ]; then
  VENV="$ROOT/.venv311"
fi

if [ -n "$VENV" ] && [ -d "$VENV" ]; then
  source "$VENV/bin/activate"
  echo "[✓] Python venv activated ($VENV)"
else
  echo "[!] No virtualenv found (.venv/.venv311) — using system Python"
fi

# Check if a Next.js frontend exists in this repo
if [ -f "$WEB_DIR/package.json" ] && grep -q '"next"' "$WEB_DIR/package.json"; then
  FRONTEND_ENABLED=true
fi

# ── 1. ChirpStack (Docker) ────────────────────────────────────────────────────
if [ "$NO_DOCKER" = false ]; then
  if command -v docker &>/dev/null; then
    echo "[→] Starting ChirpStack stack (docker compose)..."
    docker compose -f "$CHIRPSTACK_DIR/docker-compose.yml" up -d
    echo "[✓] ChirpStack started (UI: http://localhost:8080)"
  else
    echo "[!] Docker not found — skipping ChirpStack. Install: https://docs.docker.com/engine/install/"
  fi
else
  echo "[→] Skipping ChirpStack (--no-docker)"
fi

# ── DB init ───────────────────────────────────────────────────────────────────
echo "[→] Initializing/verifying SQLite schema..."
python "$ROOT/data_layer.py" --init 2>&1 | tail -1
echo "[✓] Database ready"

# ── 2. LoRa Bridge ───────────────────────────────────────────────────────────
echo "[→] Starting lora_bridge..."
if [ "$SIMULATE" = true ]; then
  nohup python "$ROOT/lora_bridge.py" --mode simulate \
    > "$LOG_DIR/lora_bridge.log" 2>&1 &
  echo $! > "$PID_DIR/lora_bridge.pid"
  echo "[✓] lora_bridge started (SIMULATE mode)"
else
  # Give ChirpStack/Mosquitto 3s to be ready before subscribing
  sleep 3
  nohup python "$ROOT/lora_bridge.py" --mode mqtt \
    > "$LOG_DIR/lora_bridge.log" 2>&1 &
  echo $! > "$PID_DIR/lora_bridge.pid"
  echo "[✓] lora_bridge started (MQTT mode → ChirpStack)"
fi

# ── 3. Sync Engine ────────────────────────────────────────────────────────────
echo "[→] Starting sync_engine..."
nohup python "$ROOT/sync_engine.py" \
  > "$LOG_DIR/sync_engine.log" 2>&1 &
echo $! > "$PID_DIR/sync_engine.pid"
echo "[✓] sync_engine started (interval: ${SYNC_INTERVAL_S:-300}s)"

# ── 4. FastAPI Backend ────────────────────────────────────────────────────────
echo "[→] Starting FastAPI backend (port 8001)..."
cd "$ROOT/backend"
nohup python -m uvicorn app.main:app \
  --host 0.0.0.0 --port 8001 --workers 1 --reload \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$PID_DIR/backend.pid"
cd "$ROOT"
echo "[✓] FastAPI started (PID: $BACKEND_PID) → http://localhost:8001"
sleep 2  # Give backend time to initialize and load config

# ── 5. Next.js Dashboard (optional) ─────────────────────────────────────────
if [ "$FRONTEND_ENABLED" = true ]; then
  echo "[→] Starting Next.js dashboard (port 3000)..."
  cd "$WEB_DIR"
  NEXT_TELEMETRY_DISABLED=1 nohup npm run dev \
    > "$LOG_DIR/frontend.log" 2>&1 &
  FRONTEND_PID=$!
  echo $FRONTEND_PID > "$PID_DIR/frontend.pid"
  cd "$ROOT"
  echo "[✓] Dashboard started (PID: $FRONTEND_PID) → http://localhost:3000"
else
  echo "[→] Skipping frontend: no Next.js app detected in $WEB_DIR"
fi

echo ""
echo "========================================================"
echo "  All services running:"
echo ""
if [ "$FRONTEND_ENABLED" = true ]; then
  echo "  Dashboard:  http://localhost:3000"
else
  echo "  Dashboard:  (not started)"
fi
echo "  Backend:    http://localhost:8001"
echo "  ChirpStack: http://localhost:8080  (user: admin/admin)"
echo "  Mosquitto:  localhost:1883 (MQTT)"
echo ""
echo "  Logs: $LOG_DIR/"
echo "  PIDs: $PID_DIR/"
echo ""
echo "========================================================"
echo ""
echo "  [→] Waiting for services to initialize (5s)..."
sleep 5

# ── Verification ──────────────────────────────────────────────────────────────
echo ""
echo "  [→] Checking service status:"
echo ""

# Check backend
if curl -s http://localhost:8001 >/dev/null 2>&1; then
  echo "  [✓] Backend running on port 8001"
else
  echo "  [!] Backend not responding — check backend/.env and logs:"
  echo "      tail -f $LOG_DIR/backend.log"
fi

# Check frontend
if [ "$FRONTEND_ENABLED" = true ]; then
  if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo "  [✓] Frontend running on port 3000"
  else
    echo "  [!] Frontend starting (may take 30-60s for Next.js compilation)"
    echo "      tail -f $LOG_DIR/frontend.log"
  fi
else
  echo "  [→] Frontend skipped"
fi

# Check WebSocket
if timeout 2 curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:8001/api/ws 2>/dev/null | grep -q "Upgrade\|websocket"; then
  echo "  [✓] WebSocket server active on port 8001"
else
  echo "  [!] WebSocket not responding — backend may not have initialized"
fi

echo ""
echo "  Next steps:"
echo "    • View dashboard: http://localhost:3000"
echo "    • Stop services:  ./kill.sh"
echo "    • Watch logs:     tail -f $LOG_DIR/backend.log"
echo ""
echo "========================================================"