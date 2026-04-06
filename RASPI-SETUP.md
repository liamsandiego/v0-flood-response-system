# RapidRelay — Raspberry Pi 5 Setup Guide
**Obando Flood Early Warning System — Ubuntu 24.04**

---

## Quick Install (Recommended)

After cloning the repository, run the automated installer:

```bash
cd /home/rapidrelay/RapidRelay
chmod +x install.sh
./install.sh
```

This handles everything: Python, Node.js, Docker, dependencies, database init.

Then start with:
```bash
./start.sh --simulate   # Test mode (no hardware)
./start.sh              # Production mode (with LoRa)
```

---

## Prerequisites

- Raspberry Pi 5 (4GB+ RAM recommended)
- Ubuntu 24.04 LTS (Server or Desktop)
- Internet connection for initial setup
- **Gateway**: TTGO T-Beam ESP32 @ **US915** (connected via USB)
- **Nodes**: ASR6601 Ra-08H @ **US915** (in the field)

> **Frequency Note**: Both gateway and nodes use US915 band for compatibility.
> The Ra-08H doesn't support AS923, so US915 is used for all devices.

---

## 1. System Dependencies

```bash
sudo apt update && sudo apt upgrade -y

# Python, pip, venv, build tools
sudo apt install -y python3 python3-pip python3-venv python3-dev \
  build-essential git curl wget

# Node.js 20 (for Next.js dashboard)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Docker (for ChirpStack stack)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Serial port access (for USB LoRa fallback)
sudo usermod -aG dialout $USER
# ⚠️ Log out and back in after this

newgrp docker  # apply docker group without logout (temporary)
```

---

## 2. Create the RapidRelay System User

```bash
sudo useradd -m -s /bin/bash rapidrelay
sudo usermod -aG dialout rapidrelay
sudo usermod -aG docker  rapidrelay
```

---

## 3. Clone the Repository

```bash
cd /home/rapidrelay
sudo -u rapidrelay git clone https://github.com/liamsandiego/v0-flood-response-system.git RapidRelay
cd RapidRelay

# Clone NewPhase branch (ML models + ChirpStack config)
sudo -u rapidrelay git clone --branch NewPhase --single-branch \
  https://github.com/Ranga428/Rapid-Relay-Pre-Prototype.git \
  Rapid-Relay-NewPhase
```

---

## 4. Python Virtual Environment

```bash
cd /home/rapidrelay/RapidRelay

# Create venv
sudo -u rapidrelay python3 -m venv .venv
source .venv/bin/activate

# Install backend dependencies
pip install --upgrade pip
pip install -r backend/requirements.txt

# Extra dependencies for LoRa bridge
pip install paho-mqtt pyserial requests python-dotenv supabase lightgbm scikit-learn
```

---

## 5. Frontend (Next.js)

```bash
cd /home/rapidrelay/RapidRelay/v0-flood-response-system
sudo -u rapidrelay npm install --legacy-peer-deps
```

---

## 6. Environment Variables

```bash
cd /home/rapidrelay/RapidRelay
sudo -u rapidrelay cp .env.example .env
sudo nano .env
```

Key variables to set in `.env`:
```bash
# REQUIRED
LOCAL_DB_PATH=/home/rapidrelay/db/local.db
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ML CONFIGURATION (NewPhase)
ML_MODE=sim                       # 'sim' for testing, 'real' for production
ML_MODEL_TYPE=lgbm                # 'lgbm' | 'xgboost' | 'rf' | 'ensemble'
ML_SCHEDULE_INTERVAL_H=12         # Hours between batch predictions

# LORA CONFIGURATION
LORA_MODE=mqtt                    # 'mqtt' | 'serial' | 'simulate'
MQTT_BROKER=localhost
MQTT_PORT=1883
LORA_SERIAL_PORT=/dev/ttyUSB0

# SYNC CONFIGURATION
SYNC_INTERVAL_S=300

# AI CONFIGURATION
OLLAMA_MODEL=llama3.2:3b
GROQ_API_KEY=your-groq-key        # for Groq AI (Woody cloud fallback)
```

---

## 7. Initialize the Database

```bash
cd /home/rapidrelay/RapidRelay
source .venv/bin/activate

# Create DB directory and initialize schema
mkdir -p /home/rapidrelay/db
python data_layer.py --init
python data_layer.py --status
```

---

## 8. Start ChirpStack (LoRaWAN Network Server)

```bash
cd /home/rapidrelay/RapidRelay/chirpstack
docker compose up -d
docker compose logs -f chirpstack  # wait for "starting api server"
```

Open http://localhost:8080 (or `http://<pi-ip>:8080` from another device):
- Login: `admin` / `admin`  ← **change immediately**
- Add a Network Server profile for **US915** (configured in docker-compose.yml)
- Register your TTGO T-Beam as a Gateway (use its MAC address as EUI)
- Register each Ra-08H node as a Device under an Application

---

## 9. Quick Test (Simulated Mode)

Before connecting real hardware, verify the full pipeline works:

```bash
cd /home/rapidrelay/RapidRelay
source .venv/bin/activate

# Terminal 1: Start backend
cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8001

# Terminal 2: Simulate LoRa readings (10 readings, no hardware needed)
python lora_bridge.py --mode simulate --count 10

# Terminal 3: Check DB
python data_layer.py --status
# Should show: unsynced_readings: 10

# Terminal 4: Sync to Supabase (needs internet + .env configured)
python sync_engine.py --once
python data_layer.py --status
# Should show: unsynced_readings: 0
```

---

## 10. Install Systemd Services (Auto-start on Boot)

```bash
cd /home/rapidrelay/RapidRelay

# Copy service files
sudo cp systemd/*.service /etc/systemd/system/

# Reload and enable
sudo systemctl daemon-reload
sudo systemctl enable rapidrelay-backend rapidrelay-lora rapidrelay-sync \
                       rapidrelay-frontend rapidrelay-ml

# Start all
sudo systemctl start rapidrelay-backend rapidrelay-lora rapidrelay-sync \
                      rapidrelay-frontend rapidrelay-ml

# Check status
sudo systemctl status rapidrelay-backend
sudo systemctl status rapidrelay-lora
```

---

## 11. Manual Start (Alternative to systemd)

```bash
cd /home/rapidrelay/RapidRelay
chmod +x start.sh kill.sh

./start.sh              # start everything
./start.sh --simulate   # start with simulated data (no hardware)
./start.sh --no-docker  # skip ChirpStack (already running separately)

./kill.sh               # stop everything
```

---

## 12. Viewing Logs

```bash
# Live logs (systemd)
sudo journalctl -u rapidrelay-backend  -f
sudo journalctl -u rapidrelay-lora     -f
sudo journalctl -u rapidrelay-sync     -f
sudo journalctl -u rapidrelay-frontend -f
sudo journalctl -u rapidrelay-ml       -f

# File logs (start.sh mode)
tail -f /home/rapidrelay/RapidRelay/logs/lora_bridge.log
tail -f /home/rapidrelay/RapidRelay/logs/sync_engine.log
tail -f /home/rapidrelay/RapidRelay/logs/backend.log
```

---

## 13. Check Sync Status

```bash
cd /home/rapidrelay/RapidRelay && source .venv/bin/activate
python data_layer.py --status
```

Output:
```
=== RapidRelay DB Sync Status ===
  unsynced_readings:  0
  unsynced_alerts:    0
  unsynced_predictions: 0
  retry_queue_size:   0
  last_sync_at:       2026-03-26T19:05:00Z
  last_sync_status:   success
```

---

## 14. Serial Port (Fallback Mode)

If not using ChirpStack/MQTT and connecting TTGO T-Beam directly via USB:

```bash
# Check if device is visible
ls -la /dev/ttyUSB* /dev/ttyACM*

# Test serial mode
python lora_bridge.py --mode serial --port auto

# Or force a specific port
python lora_bridge.py --mode serial --port /dev/ttyUSB0
```

Update `.env`:
```bash
LORA_MODE=serial
LORA_SERIAL_PORT=/dev/ttyUSB0
```

---

## 15. Access Points

| Service | Address | Notes |
|---|---|---|
| Dashboard | `http://<pi-ip>:3000` | Open from any device on the network |
| Backend API | `http://<pi-ip>:8001` | FastAPI REST + WebSocket |
| API Docs | `http://<pi-ip>:8001/docs` | Swagger UI |
| ChirpStack | `http://<pi-ip>:8080` | LoRaWAN management |
| Mosquitto | `<pi-ip>:1883` | MQTT broker |
| Supabase | Cloud dashboard | Only when internet available |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Permission denied: /dev/ttyUSB0` | `sudo usermod -aG dialout rapidrelay && logout` |
| ChirpStack not starting | `docker compose -f chirpstack/docker-compose.yml logs chirpstack` |
| Dashboard can't connect to backend | Check `http://localhost:8001/health` |
| Readings not syncing to Supabase | `python sync_engine.py --once --dry-run`, check `.env` credentials |
| LGBM model not found | Ensure `Rapid-Relay-NewPhase/` is cloned, run `python data_layer.py --init` |
| `paho-mqtt not installed` | `pip install paho-mqtt` in venv |
| ML predictions showing "rule_based" | Need 48+ hours of data before ML kicks in |
| ChirpStack frequency mismatch | Verify region is `us915_0` in docker-compose.yml |

---

## NewPhase ML Integration

The backend uses the **NewPhase ML pipeline** for flood prediction:

### Models (in `Rapid-Relay-NewPhase/flood_preprototype/model/`)
| Model | File | Features |
|-------|------|----------|
| LightGBM (primary) | `flood_lgbm_sensor.pkl` | 27 sensor features |
| XGBoost (fallback) | `flood_xgb_sensor.pkl` | 27 sensor features |
| RandomForest | `flood_rf_sensor.pkl` | 27 sensor features |

### Feature Engineering
The `backend/app/services/newphase_adapter.py` computes 27 features including:
- Water level stats (max, slope, std, lag)
- Soil moisture trends
- Humidity patterns
- Seasonal encoding (sin/cos for month/week)
- Cross-sensor interactions

### Minimum Data Requirements
- **48 hours** of sensor data before ML predictions activate
- Uses rule-based fallback until sufficient data collected
- Buffer size: 336 samples (14 days hourly) for full feature computation

### Verifying ML is Working
```bash
curl http://localhost:8001/api/predictions/status
# Should show: model_loaded: true, model_type: "lgbm", buffer_size: N
```

