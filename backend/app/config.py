# =============================================================================
# RapidRelay – Configuration
#
# Centralized settings loaded from environment variables with sensible defaults.
# =============================================================================

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend dir, then project root
_env_candidates = [
    Path(__file__).resolve().parent.parent / ".env",
    Path(__file__).resolve().parent.parent.parent / ".env",
]
for _e in _env_candidates:
    if _e.exists():
        load_dotenv(_e)
        break

# Project paths
BACKEND_DIR  = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent

# NewPhase prototype (cloned branch — primary ML source)
NEWPHASE_DIR  = PROJECT_ROOT / "Rapid-Relay-NewPhase" / "flood_preprototype"
PROTOTYPE_DIR = PROJECT_ROOT / "Rapid-Relay-Pre-Prototype-main" / "flood_preprototype"

# ── ML models (NewPhase LGBM sensor variant is the primary model) ──────────
# LGBM sensor: no satellite data needed → works fully offline on RPi
MODEL_PATH_LGBM   = NEWPHASE_DIR  / "model"  / "flood_lgbm_sensor.pkl"
MODEL_PATH_XGB    = NEWPHASE_DIR  / "model"  / "flood_xgb_sensor.pkl"
MODEL_PATH_RF     = NEWPHASE_DIR  / "model"  / "flood_rf_sensor.pkl"
# Legacy fallback (old prototype)
MODEL_PATH_LEGACY = PROTOTYPE_DIR / "models" / "trained" / "flood_xgb_model.pkl"
# Active model used by prediction service
MODEL_PATH = MODEL_PATH_LGBM if MODEL_PATH_LGBM.exists() else MODEL_PATH_LEGACY

# ── Data files ───────────────────────────────────────────────────────────────
EO_TIMESERIES_CSV = NEWPHASE_DIR  / "data" / "sentinel1" / "GEE-Processing" / "sentinel1_timeseries.csv"
SENSOR_CSV        = NEWPHASE_DIR  / "data" / "sensor"    / "obando_environmental_data.csv"
FLOOD_DATASET_CSV = NEWPHASE_DIR  / "data" / "flood_dataset.csv"
THRESHOLDS_YAML   = NEWPHASE_DIR  / "config" / "thresholds.yaml"
AOI_GEOJSON       = NEWPHASE_DIR  / "config" / "aoi.geojson"

# ── Database — SHARED SQLite with lora_bridge and sync_engine ───────────────
#
# All three processes (lora_bridge, sync_engine, FastAPI) use the same file.
# Set LOCAL_DB_PATH in .env to override.
# Linux/RPi default: /home/rapidrelay/db/local.db
# Windows dev default: D:/raprelay/db/local.db
_default_db = (
    "/home/rapidrelay/db/local.db"
    if os.name != "nt"
    else "D:/raprelay/db/local.db"
)
LOCAL_DB_PATH = Path(os.environ.get("LOCAL_DB_PATH", _default_db))
DATABASE_URL  = os.getenv(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{LOCAL_DB_PATH}"
)

# ── WebSocket / Prediction intervals ─────────────────────────────────────────
WS_BROADCAST_INTERVAL = float(os.getenv("WS_BROADCAST_INTERVAL", "5.0"))
PREDICTION_INTERVAL   = float(os.getenv("PREDICTION_INTERVAL",   "300"))  # 5 min

# ── Sensor thresholds ─────────────────────────────────────────────────────────
SENSOR_THRESHOLDS = {
    "water_level":  {"warning": 1.5, "critical": 2.5},
    "soil_moisture":{"warning": 60,  "critical": 80},
    "humidity":     {"warning": 75,  "critical": 90},
    "rainfall":     {"warning": 7.5, "critical": 30},
}
ALERT_THRESHOLDS = {
    "CLEAR":   0.0,
    "WATCH":   0.40,
    "WARNING": 0.60,
    "DANGER":  0.80,
}

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000"
).split(",")

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL         = os.getenv("NEXT_PUBLIC_SUPABASE_URL", os.getenv("SUPABASE_URL", ""))
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))

# ── AI / LLM ──────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

# ── LoRa / MQTT ───────────────────────────────────────────────────────────────
LORA_MODE        = os.getenv("LORA_MODE",   "mqtt")          # 'mqtt' | 'serial' | 'simulate'
LORA_SERIAL_PORT = os.getenv("LORA_SERIAL_PORT", "/dev/ttyUSB0")
MQTT_BROKER      = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT        = int(os.getenv("MQTT_PORT", "1883"))

# ── Obando deployment ─────────────────────────────────────────────────────────
DEPLOYMENT_LAT = 14.7094
DEPLOYMENT_LON = 120.9358
