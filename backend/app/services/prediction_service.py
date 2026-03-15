# =============================================================================
# RapidRelay – ML Prediction Service
#
# Loads the trained XGBoost model and provides real-time flood predictions.
# Integrates with the feature engineering pipeline from the ML directory.
# =============================================================================

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd

from app.config import MODEL_PATH, ALERT_THRESHOLDS, EO_TIMESERIES_CSV, SENSOR_CSV

logger = logging.getLogger("rapidrelay.ml")

# Feature columns must match feature_engineering.py FEATURE_COLUMNS exactly
FEATURE_COLUMNS = [
    "max_water_level_6h",
    "max_water_level_24h",
    "water_level_slope_3h",
    "water_level_slope_6h",
    "water_level_std_24h",
    "rainfall_sum_1h",
    "rainfall_sum_6h",
    "rainfall_sum_24h",
    "rainfall_max_intensity",
    "humidity_mean_24h",
    "humidity_trend_6h",
    "soil_saturation",
    "soil_saturation_mean_24h",
]


class FloodPredictionService:
    """Wraps the trained XGBoost model for real-time inference."""

    def __init__(self):
        self.model = None
        self.model_loaded = False
        self._sensor_buffer: list[dict] = []  # rolling buffer of raw readings
        self._latest_eo: dict = {}
        self._load_model()
        self._load_latest_eo()

    def _load_model(self):
        if MODEL_PATH.exists():
            try:
                self.model = joblib.load(str(MODEL_PATH))
                self.model_loaded = True
                logger.info(f"XGBoost model loaded from {MODEL_PATH}")
            except Exception as e:
                logger.error(f"Failed to load model: {e}")
                self.model_loaded = False
        else:
            logger.warning(f"No model found at {MODEL_PATH}. Using rule-based fallback.")
            self.model_loaded = False

    def _load_latest_eo(self):
        """Load the most recent EO features from the Sentinel-1 timeseries CSV."""
        if EO_TIMESERIES_CSV.exists():
            try:
                df = pd.read_csv(str(EO_TIMESERIES_CSV))
                if len(df) > 0:
                    last = df.iloc[-1]
                    self._latest_eo = {
                        "soil_saturation": float(last.get("soil_saturation", 0.5)),
                        "flood_extent": float(last.get("flood_extent", 0.0)),
                        "wetness_trend": int(last.get("wetness_trend", 0)),
                    }
                    logger.info(f"Loaded latest EO: {self._latest_eo}")
            except Exception as e:
                logger.error(f"Failed to load EO data: {e}")

    def ingest_reading(self, reading: dict):
        """Add a sensor reading to the rolling buffer (max 168 for 7 days daily)."""
        self._sensor_buffer.append(reading)
        if len(self._sensor_buffer) > 168:
            self._sensor_buffer = self._sensor_buffer[-168:]

    def predict(self) -> dict:
        """
        Run flood prediction using the latest sensor buffer + EO data.

        Returns dict with: flood_probability, alert_level, features_used, method
        """
        if self.model_loaded and len(self._sensor_buffer) >= 7:
            return self._predict_ml()
        else:
            return self._predict_rules()

    def _predict_ml(self) -> dict:
        """XGBoost-based prediction using engineered features."""
        try:
            features = self._engineer_features()
            if features is None:
                return self._predict_rules()

            X = np.array([[features.get(col, 0.0) for col in FEATURE_COLUMNS]])
            prob = float(self.model.predict_proba(X)[0][1])
            alert = self._classify_alert(prob)

            return {
                "flood_probability": round(prob, 4),
                "alert_level": alert,
                "features_used": features,
                "method": "xgboost",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"ML prediction failed: {e}, falling back to rules")
            return self._predict_rules()

    def _predict_rules(self) -> dict:
        """Rule-based fallback using weighted sensor + EO index."""
        if not self._sensor_buffer:
            return {
                "flood_probability": 0.0,
                "alert_level": "CLEAR",
                "features_used": {},
                "method": "no_data",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        latest = self._sensor_buffer[-1]
        water = latest.get("water_level", 0)
        rain = latest.get("rainfall", 0)
        hum = latest.get("humidity", 50)

        # Normalize to 0-1
        water_score = min(max(water / 3.0, 0), 1.0)
        rain_score = min(max(rain / 50.0, 0), 1.0)
        hum_score = min(max(hum / 100.0, 0), 1.0)
        sensor_index = 0.4 * rain_score + 0.3 * hum_score + 0.3 * water_score

        soil = self._latest_eo.get("soil_saturation", 0.5)
        flood = self._latest_eo.get("flood_extent", 0.0)
        trend = self._latest_eo.get("wetness_trend", 0)
        trend_map = {-1: 0.0, 0: 0.5, 1: 1.0}
        eo_index = (
            0.4 * min(soil, 1.0) +
            0.3 * min(flood / 0.5, 1.0) +
            0.3 * trend_map.get(trend, 0.5)
        )

        risk = round(0.5 * sensor_index + 0.5 * eo_index, 4)
        alert = self._classify_alert(risk)

        return {
            "flood_probability": risk,
            "alert_level": alert,
            "features_used": {
                "water_level": water, "rainfall": rain, "humidity": hum,
                "soil_saturation": soil, "flood_extent": flood,
                "sensor_index": round(sensor_index, 4),
                "eo_index": round(eo_index, 4),
            },
            "method": "rule_based",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _engineer_features(self) -> Optional[dict]:
        """Build ML features from the sensor buffer."""
        if len(self._sensor_buffer) < 7:
            return None

        df = pd.DataFrame(self._sensor_buffer)
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df = df.set_index("timestamp").sort_index()
        else:
            df.index = pd.date_range(
                end=pd.Timestamp.now("UTC"), periods=len(df), freq="1D"
            )

        # Add soil saturation from latest EO
        df["soil_saturation"] = self._latest_eo.get("soil_saturation", 0.5)

        features = {}
        wl = df.get("water_level", pd.Series(dtype=float))
        rf = df.get("rainfall", pd.Series(dtype=float))
        hu = df.get("humidity", pd.Series(dtype=float))
        ss = df.get("soil_saturation", pd.Series(dtype=float))

        # Water level features (daily data, 7-day/14-day windows)
        features["max_water_level_6h"] = float(wl.iloc[-1:].max()) if len(wl) > 0 else 0
        features["max_water_level_24h"] = float(wl.iloc[-7:].max()) if len(wl) > 0 else 0
        features["water_level_slope_3h"] = float(wl.iloc[-1] - wl.iloc[-2]) if len(wl) >= 2 else 0
        features["water_level_slope_6h"] = float(wl.iloc[-1] - wl.iloc[-2]) if len(wl) >= 2 else 0
        features["water_level_std_24h"] = float(wl.iloc[-7:].std()) if len(wl) >= 2 else 0

        # Rainfall features
        features["rainfall_sum_1h"] = float(rf.iloc[-1:].sum()) if len(rf) > 0 else 0
        features["rainfall_sum_6h"] = float(rf.iloc[-1:].sum()) if len(rf) > 0 else 0
        features["rainfall_sum_24h"] = float(rf.iloc[-7:].sum()) if len(rf) > 0 else 0
        features["rainfall_max_intensity"] = float(rf.iloc[-1:].max()) if len(rf) > 0 else 0

        # Humidity features
        features["humidity_mean_24h"] = float(hu.iloc[-7:].mean()) if len(hu) > 0 else 50
        features["humidity_trend_6h"] = float(hu.iloc[-1] - hu.iloc[-2]) if len(hu) >= 2 else 0

        # Soil saturation
        features["soil_saturation"] = float(ss.iloc[-1]) if len(ss) > 0 else 0.5
        features["soil_saturation_mean_24h"] = float(ss.iloc[-7:].mean()) if len(ss) > 0 else 0.5

        return features

    def _classify_alert(self, prob: float) -> str:
        if prob >= ALERT_THRESHOLDS["DANGER"]:
            return "DANGER"
        elif prob >= ALERT_THRESHOLDS["WARNING"]:
            return "WARNING"
        elif prob >= ALERT_THRESHOLDS["WATCH"]:
            return "WATCH"
        return "CLEAR"

    def get_status(self) -> dict:
        return {
            "model_loaded": self.model_loaded,
            "model_path": str(MODEL_PATH),
            "buffer_size": len(self._sensor_buffer),
            "latest_eo": self._latest_eo,
            "feature_count": len(FEATURE_COLUMNS),
        }


# Singleton instance
prediction_service = FloodPredictionService()
