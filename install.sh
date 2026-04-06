#!/bin/bash
# =============================================================================
# RapidRelay — Automated Raspberry Pi 5 Installation Script
#
# Run this script once after cloning the repository:
#   chmod +x install.sh && ./install.sh
#
# What it does:
#   1. Installs system dependencies (Python, Node.js, Docker)
#   2. Creates Python virtual environment
#   3. Installs Python dependencies
#   4. Sets up Node.js for the dashboard
#   5. Creates database directories
#   6. Configures .env from template
#   7. Initializes SQLite database
#   8. Registers systemd services (optional)
#
# After installation, run: ./start.sh
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"

echo -e "${BLUE}"
echo "========================================================"
echo "  RapidRelay — Raspberry Pi 5 Installation"
echo "  Obando Flood Early Warning System"
echo "========================================================"
echo -e "${NC}"

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${YELLOW}[!] This script is designed for Linux/Raspberry Pi.${NC}"
    echo -e "${YELLOW}    Some steps may not work on $(uname -s).${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# ── 1. System Dependencies ───────────────────────────────────────────────────
echo -e "\n${BLUE}[1/8] Checking system dependencies...${NC}"

# Check for Python 3.10+
if command -v python3 &>/dev/null; then
    PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    echo -e "${GREEN}  [✓] Python $PYTHON_VERSION found${NC}"
else
    echo -e "${RED}  [✗] Python 3 not found. Installing...${NC}"
    sudo apt update && sudo apt install -y python3 python3-pip python3-venv
fi

# Check for Node.js 18+
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}  [✓] Node.js $NODE_VERSION found${NC}"
else
    echo -e "${YELLOW}  [!] Node.js not found. Installing via NodeSource...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Check for Docker
if command -v docker &>/dev/null; then
    DOCKER_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
    echo -e "${GREEN}  [✓] Docker $DOCKER_VERSION found${NC}"
else
    echo -e "${YELLOW}  [!] Docker not found. Installing...${NC}"
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    echo -e "${YELLOW}  [!] You may need to log out and back in for Docker group changes.${NC}"
fi

# Check for docker compose
if docker compose version &>/dev/null 2>&1; then
    echo -e "${GREEN}  [✓] Docker Compose found${NC}"
else
    echo -e "${YELLOW}  [!] Docker Compose plugin not found. Installing...${NC}"
    sudo apt install -y docker-compose-plugin
fi

# ── 2. Python Virtual Environment ────────────────────────────────────────────
echo -e "\n${BLUE}[2/8] Setting up Python virtual environment...${NC}"

if [ -d "$VENV" ]; then
    echo -e "${GREEN}  [✓] Virtual environment exists at $VENV${NC}"
else
    echo -e "${YELLOW}  [→] Creating virtual environment...${NC}"
    python3 -m venv "$VENV"
    echo -e "${GREEN}  [✓] Virtual environment created${NC}"
fi

# Activate venv
source "$VENV/bin/activate"

# ── 3. Python Dependencies ───────────────────────────────────────────────────
echo -e "\n${BLUE}[3/8] Installing Python dependencies...${NC}"

pip install --upgrade pip wheel setuptools

# Install backend requirements (includes optional ML packages)
if [ -f "$ROOT/backend/requirements.txt" ]; then
    pip install -r "$ROOT/backend/requirements.txt"
    echo -e "${GREEN}  [✓] Backend dependencies installed${NC}"
fi

# Install LoRa dependencies
echo -e "${YELLOW}  [→] Installing LoRa/MQTT packages...${NC}"
pip install paho-mqtt pyserial

# Install Ollama client (for Woody AI)
pip install requests

echo -e "${GREEN}  [✓] All Python dependencies installed${NC}"

# ── 4. Node.js Dependencies ──────────────────────────────────────────────────
echo -e "\n${BLUE}[4/8] Installing Node.js dependencies for dashboard...${NC}"

if [ -d "$ROOT/v0-flood-response-system" ]; then
    cd "$ROOT/v0-flood-response-system"
    npm install
    cd "$ROOT"
    echo -e "${GREEN}  [✓] Dashboard dependencies installed${NC}"
else
    echo -e "${YELLOW}  [!] Dashboard directory not found, skipping npm install${NC}"
fi

# ── 5. Create Directories ────────────────────────────────────────────────────
echo -e "\n${BLUE}[5/8] Creating required directories...${NC}"

# Database directory
DB_DIR="/home/rapidrelay/db"
if [ ! -d "$DB_DIR" ]; then
    sudo mkdir -p "$DB_DIR"
    sudo chown $USER:$USER "$DB_DIR"
    echo -e "${GREEN}  [✓] Created $DB_DIR${NC}"
else
    echo -e "${GREEN}  [✓] $DB_DIR exists${NC}"
fi

# Logs directory
mkdir -p "$ROOT/logs"
echo -e "${GREEN}  [✓] Created $ROOT/logs${NC}"

# ── 6. Configure Environment ─────────────────────────────────────────────────
echo -e "\n${BLUE}[6/8] Configuring environment...${NC}"

if [ ! -f "$ROOT/.env" ]; then
    if [ -f "$ROOT/.env.example" ]; then
        cp "$ROOT/.env.example" "$ROOT/.env"
        echo -e "${GREEN}  [✓] Created .env from template${NC}"
        echo -e "${YELLOW}  [!] Edit .env to add your Supabase credentials and other settings${NC}"
    else
        # Create minimal .env
        cat > "$ROOT/.env" << 'EOF'
# RapidRelay Configuration
LOCAL_DB_PATH=/home/rapidrelay/db/local.db
LORA_MODE=mqtt
SYNC_INTERVAL_S=300
OLLAMA_MODEL=llama3.2:3b
EOF
        echo -e "${GREEN}  [✓] Created minimal .env${NC}"
    fi
else
    echo -e "${GREEN}  [✓] .env already exists${NC}"
fi

# ── 7. Initialize Database ───────────────────────────────────────────────────
echo -e "\n${BLUE}[7/8] Initializing SQLite database...${NC}"

cd "$ROOT"
source "$VENV/bin/activate"

if [ -f "$ROOT/data_layer.py" ]; then
    python "$ROOT/data_layer.py" --init
    echo -e "${GREEN}  [✓] Database initialized${NC}"
else
    echo -e "${YELLOW}  [!] data_layer.py not found, skipping database init${NC}"
fi

# ── 8. Systemd Services (Optional) ───────────────────────────────────────────
echo -e "\n${BLUE}[8/8] Systemd service registration...${NC}"

read -p "Register systemd services for auto-start on boot? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -d "$ROOT/systemd" ]; then
        # Update paths in service files
        for svc in "$ROOT/systemd"/*.service; do
            sudo cp "$svc" /etc/systemd/system/
        done
        sudo systemctl daemon-reload

        # Enable services
        sudo systemctl enable rapidrelay-backend.service || true
        sudo systemctl enable rapidrelay-lora.service || true
        sudo systemctl enable rapidrelay-sync.service || true
        sudo systemctl enable rapidrelay-frontend.service || true

        echo -e "${GREEN}  [✓] Systemd services registered${NC}"
        echo -e "${YELLOW}  [!] Start with: sudo systemctl start rapidrelay-backend${NC}"
    else
        echo -e "${YELLOW}  [!] systemd directory not found${NC}"
    fi
else
    echo -e "${YELLOW}  [→] Skipping systemd registration${NC}"
    echo -e "${YELLOW}      Use ./start.sh to run manually${NC}"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}"
echo "========================================================"
echo "  Installation Complete!"
echo "========================================================"
echo -e "${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit configuration:"
echo "     nano .env"
echo ""
echo "  2. Start all services (simulate mode):"
echo "     ./start.sh --simulate"
echo ""
echo "  3. Start with real LoRa hardware:"
echo "     ./start.sh"
echo ""
echo "  4. Check status:"
echo "     python data_layer.py --status"
echo ""
echo "  Endpoints after starting:"
echo "    Dashboard:  http://localhost:3000"
echo "    Backend:    http://localhost:8001"
echo "    ChirpStack: http://localhost:8080 (admin/admin)"
echo ""
echo "  Logs: $ROOT/logs/"
echo ""
