#!/bin/bash
# =============================================================================
# RapidRelay — Stop All Services (Raspberry Pi 5 / Ubuntu)
# Replaces: kill.bat (Windows)
# =============================================================================

PID_DIR="/tmp/rapidrelay"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHIRPSTACK_DIR="$ROOT/chirpstack"

echo "========================================================"
echo "  RapidRelay — Stopping all services..."
echo "========================================================"

# Kill Python processes via PID files
for service in lora_bridge sync_engine backend; do
  PID_FILE="$PID_DIR/${service}.pid"
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      echo "[✓] Stopped $service (PID $PID)"
    else
      echo "[!] $service was not running (PID $PID stale)"
    fi
    rm -f "$PID_FILE"
  else
    echo "[-] $service: no PID file found"
  fi
done

# Kill Next.js (may have spawned node child processes)
PID_FILE="$PID_DIR/frontend.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  # Kill process group so child node processes also die
  if kill -0 "$PID" 2>/dev/null; then
    kill -- -"$(ps -o pgid= -p "$PID" | tr -d ' ')" 2>/dev/null || kill "$PID"
    echo "[✓] Stopped frontend (PID $PID)"
  fi
  rm -f "$PID_FILE"
fi

# Stop ChirpStack Docker stack
if command -v docker &>/dev/null && [ -f "$CHIRPSTACK_DIR/docker-compose.yml" ]; then
  echo "[→] Stopping ChirpStack stack..."
  docker compose -f "$CHIRPSTACK_DIR/docker-compose.yml" down
  echo "[✓] ChirpStack stopped"
fi

echo ""
echo "[✓] All RapidRelay services stopped."
echo "========================================================"
