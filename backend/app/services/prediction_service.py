# =============================================================================
# RapidRelay – ML Prediction Service
#
# Loads the trained NewPhase ML model and provides real-time flood predictions.
# Uses the 25-feature NewPhase pipeline via newphase_adapter.py
# =============================================================================

import logging
from datetime import datetime, timezone
from typing import Optional

import joblib
import numpy as np
import pandas as pd

from app.config import (
    MODEL_PATH,
    MODEL_PATH_LGBM,
    MODEL_PATH_XGB,
    MODEL_PATH_RF,
    ALERT_THRESHOLDS,
    EO_TIMESERIES_CSV,
    SENSOR_CSV,
)
from app.services.newphase_adapter import (
    build_realtime_features,
    SENSOR_FEATURE_COLUMNS,
    validate_model_compatibility,
    NewPhaseEnsemble,
)

logger = logging.getLogger("rapidrelay.ml")

# Use NewPhase 25-feature columns
FEATURE_COLUMNS = SENSOR_FEATURE_COLUMNS


class FloodPredictionService:
    """Wraps the trained NewPhase ML models (ensemble: LGBM, XGBoost, RandomForest) for real-time inference."""

    def __init__(self):
        self.model = None
        self.ensemble = None
        self.model_loaded = False
        self.model_type = "ensemble"  # Now using ensemble of 3 models
        self._sensor_buffer: list[dict] = []  # rolling buffer of raw readings
        self._latest_eo: dict = {}
        self._load_ensemble()
        self._load_latest_eo()

    def _load_ensemble(self):
        """Load the NewPhase ML ensemble (LGBM, XGBoost, RandomForest)."""
        try:
            self.ensemble = NewPhaseEnsemble()
            self.model_loaded = len(self.ensemble.models) > 0
            if self.model_loaded:
                logger.info(f"ML ensemble loaded with {len(self.ensemble.models)} models")
            else:
                logger.warning("NewPhase ensemble loaded but no models available")
        except Exception as e:
            logger.error(f"Failed to load ensemble: {e}")
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
        """Add a sensor reading to the rolling buffer (max 336 for 14 days hourly)."""
        self._sensor_buffer.append(reading)
        # Keep 14 days of hourly data (336 samples) for NewPhase features
        if len(self._sensor_buffer) > 336:
            self._sensor_buffer = self._sensor_buffer[-336:]

    def predict(self) -> dict:
        """
        Run flood prediction using the latest sensor buffer + EO data.

        Returns dict with: flood_probability, alert_level, features_used, method
        """
        # NewPhase requires at least 48 hours of data
        if self.model_loaded and len(self._sensor_buffer) >= 48:
            return self._predict_ml()
        else:
            return self._predict_rules()

    def _predict_ml(self) -> dict:
        """NewPhase ML ensemble prediction using 40 engineered sensor features."""
        try:
            # Use NewPhase adapter for feature engineering
            features = build_realtime_features(self._sensor_buffer, freq="1h")

            if features is None:
                logger.warning("Feature engineering returned None, falling back to rules")
                return self._predict_rules()

            # Use ensemble for prediction
            result = self.ensemble.predict(features)

            # Map ensemble result to standard format
            return {
                "flood_probability": result.get("flood_probability", 0.0),
                "alert_level": result.get("alert_level", "CLEAR"),
                "features_used": features,
                "method": result.get("method", "ensemble"),
                "variance": result.get("variance", 0.0),
                "timestamp": result.get("timestamp", datetime.now(timezone.utc).isoformat()),
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
            "model_type": self.model_type if self.model_loaded else None,
            "model_path": str(MODEL_PATH),
            "buffer_size": len(self._sensor_buffer),
            "min_buffer_required": 48,
            "latest_eo": self._latest_eo,
            "feature_count": len(FEATURE_COLUMNS),
        }


# Singleton instance
prediction_service = FloodPredictionService()
