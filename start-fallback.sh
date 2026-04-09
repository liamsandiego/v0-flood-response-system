#!/bin/bash
# =============================================================================
# RapidRelay — Start Backend in Fallback Mode (Raspberry Pi 5 / Ubuntu)
# 
# This runs the device as a secondary backup clone that pulls data from the Cloud 
# (Supabase) to store locally, bypassing local LoRa sensor inputs. This ensures 
# local clients still have access to continuous dashboard data if Cloud goes offline.
#
# Services started:
#   1. fallback_sync.py  — Supabase Cloud → local SQLite pipeline
#   2. FastAPI backend   (port 8001)
#   3. Next.js dashboard (port 3000)
#
# Usage:
#   ./start-fallback.sh
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="/tmp/rapidrelay"
LOG_DIR="$ROOT/logs"
VENV=""
WEB_DIR="$ROOT"
FRONTEND_ENABLED=false

# Load .env if present
[ -f "$ROOT/.env" ] && set -a && source "$ROOT/.env" && set +a

# Local-first persistence default path on Raspberry Pi
export LOCAL_DB_PATH="${LOCAL_DB_PATH:-/home/rapidrelay/db/local.db}"

mkdir -p "$PID_DIR" "$LOG_DIR"

echo "========================================================"
echo "  RapidRelay — Obando Flood Early Warning System"
echo "  Starting services in FALLBACK MODE (Cloud → Local)"
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

# ── 1. DB init ───────────────────────────────────────────────────────────────────
echo "[→] Initializing/verifying SQLite schema..."
python "$ROOT/data_layer.py" --init 2>&1 | tail -1
echo "[✓] Database ready"

# ── 2. Fallback Sync Engine (Cloud -> Local) ──────────────────────────────────
echo "[→] Starting fallback_sync..."
nohup python "$ROOT/fallback_sync.py" \
  > "$LOG_DIR/fallback_sync.log" 2>&1 &
echo $! > "$PID_DIR/fallback_sync.pid"
echo "[✓] fallback_sync started (interval: ${FALLBACK_SYNC_INTERVAL_S:-60}s)"

# ── 3. FastAPI Backend ────────────────────────────────────────────────────────
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

# ── 4. Next.js Dashboard (optional) ─────────────────────────────────────────
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
echo "  Fallback services running:"
echo ""
if [ "$FRONTEND_ENABLED" = true ]; then
  echo "  Dashboard:     http://localhost:3000"
else
  echo "  Dashboard:     (not started)"
fi
echo "  Backend API:   http://localhost:8001"
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

echo ""
echo "  Next steps:"
echo "    • View dashboard: http://localhost:3000"
echo "    • Stop services:  ./kill.sh"
echo "    • Watch logs:     tail -f $LOG_DIR/fallback_sync.log"
echo ""
echo "========================================================"
