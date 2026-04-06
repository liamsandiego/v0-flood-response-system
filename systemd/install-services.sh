#!/bin/bash
# =============================================================================
# RapidRelay — Systemd Service Installation & Setup
#
# Installs RapidRelay as systemd services for persistent background operation.
# Services auto-start on RPi reboot and auto-restart on failure.
#
# Usage (from RapidRelay root directory):
#   sudo bash systemd/install-services.sh
#
# After installation:
#   sudo systemctl start rapidrelay.target     # Start all services
#   sudo systemctl status rapidrelay.target    # Check status
#   sudo systemctl enable rapidrelay.target    # Auto-start on boot
#   sudo journalctl -u rapidrelay-backend -f   # View logs (any service)
# =============================================================================

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "[!] This script must be run as root (use sudo)"
    exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="$ROOT/systemd"

echo "========================================================"
echo "  RapidRelay — Systemd Service Installation"
echo "========================================================"
echo ""

# Create rapidrelay user if it doesn't exist
if ! id "rapidrelay" &>/dev/null 2>&1; then
    echo "[→] Creating 'rapidrelay' system user..."
    useradd -r -s /bin/bash -d /home/rapidrelay -m rapidrelay 2>/dev/null || true
    echo "[✓] User created (or already exists)"
fi

# Ensure rapidrelay owns the RapidRelay directory
echo "[→] Setting permissions for rapidrelay user..."
chown -R rapidrelay:rapidrelay "$ROOT"
chown -R rapidrelay:rapidrelay /home/rapidrelay/db
echo "[✓] Permissions set"

# Copy systemd service files
echo "[→] Installing systemd service files..."
cp "$SYSTEMD_DIR/rapidrelay-database.service" /etc/systemd/system/
cp "$SYSTEMD_DIR/rapidrelay-lora-bridge.service" /etc/systemd/system/
cp "$SYSTEMD_DIR/rapidrelay-sync-engine.service" /etc/systemd/system/
cp "$SYSTEMD_DIR/rapidrelay-backend.service" /etc/systemd/system/
cp "$SYSTEMD_DIR/rapidrelay-frontend.service" /etc/systemd/system/
cp "$SYSTEMD_DIR/rapidrelay.target" /etc/systemd/system/
echo "[✓] Service files installed"

# Reload systemd daemon
echo "[→] Reloading systemd..."
systemctl daemon-reload
echo "[✓] Systemd reloaded"

# Enable services (auto-start on boot)
echo "[→] Enabling services for auto-start..."
systemctl enable rapidrelay-database.service
systemctl enable rapidrelay-lora-bridge.service
systemctl enable rapidrelay-sync-engine.service
systemctl enable rapidrelay-backend.service
systemctl enable rapidrelay-frontend.service
systemctl enable rapidrelay.target
echo "[✓] Services enabled for auto-start on boot"

echo ""
echo "========================================================"
echo "  Installation Complete!"
echo "========================================================"
echo ""
echo "  Next commands:"
echo ""
echo "  1. Start all RapidRelay services:"
echo "     sudo systemctl start rapidrelay.target"
echo ""
echo "  2. Check status (all services):"
echo "     sudo systemctl status rapidrelay.target"
echo ""
echo "  3. View logs (real-time, all services):"
echo "     sudo journalctl -u rapidrelay-backend -f"
echo "     sudo journalctl -u rapidrelay-lora-bridge -f"
echo "     sudo journalctl -u rapidrelay-sync-engine -f"
echo "     sudo journalctl -u rapidrelay-frontend -f"
echo ""
echo "  4. Stop all services:"
echo "     sudo systemctl stop rapidrelay.target"
echo ""
echo "  5. Restart single service (without stopping others):"
echo "     sudo systemctl restart rapidrelay-backend.service"
echo ""
echo "  ℹ️  Services will auto-start on RPi reboot"
echo "========================================================"
