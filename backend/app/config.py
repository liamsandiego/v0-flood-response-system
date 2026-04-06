# =============================================================================
# RapidRelay – Configuration
#
# Centralized settings loaded from environment variables with sensible defaults.
# =============================================================================

import os
from pathlib import Path
from functools import lru_cache
from dotenv import load_dotenv

# Load .env from backend directory
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Project paths
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
PROTOTYPE_DIR = PROJECT_ROOT / "Rapid-Relay-Pre-Prototype-main" / "flood_preprototype"

# ML model
MODEL_PATH = PROTOTYPE_DIR / "models" / "trained" / "flood_xgb_model.pkl"

# Data files
EO_TIMESERIES_CSV = PROTOTYPE_DIR / "data" / "sentinel1" / "GEE-Processing" / "sentinel1_timeseries.csv"
SENSOR_CSV = PROTOTYPE_DIR / "data" / "sensor" / "obando_environmental_data.csv"
THRESHOLDS_YAML = PROTOTYPE_DIR / "config" / "thresholds.yaml"
AOI_GEOJSON = PROTOTYPE_DIR / "config" / "aoi.geojson"

# Database
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{BACKEND_DIR / 'rapidrelay.db'}")

# WebSocket
WS_BROADCAST_INTERVAL = float(os.getenv("WS_BROADCAST_INTERVAL", "5.0"))

# ML prediction
PREDICTION_INTERVAL = float(os.getenv("PREDICTION_INTERVAL", "300"))  # 5 minutes

# Sensor thresholds (matching frontend constants.ts)
SENSOR_THRESHOLDS = {
    "water_level": {"warning": 1.5, "critical": 2.5},
    "soil_moisture": {"warning": 60, "critical": 80},
    "humidity": {"warning": 75, "critical": 90},
    "rainfall": {"warning": 7.5, "critical": 30},
}

# Alert thresholds (maps to enum: NORMAL|WATCH|WARNING|EMERGENCY)
ALERT_THRESHOLDS = {
    "NORMAL": 0.0,
    "WATCH": 0.40,
    "WARNING": 0.60,
    "DANGER": 0.80,     # legacy key, maps to EMERGENCY
    "EMERGENCY": 0.80,
}

# CORS origins
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000").split(",")

# Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Groq AI
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# Obando deployment coordinates
DEPLOYMENT_LAT = 14.7094
DEPLOYMENT_LON = 120.9358
