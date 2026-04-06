"""
ensemble_ml.py — 3-model ensemble with uncertainty quantification
RapidRelay / Obando Flood Early Warning System

Loads NewPhase models:
    - LightGBM (flood_lgbm_sensor.pkl)
    - XGBoost (flood_xgb_sensor.pkl)
    - RandomForest (flood_rf_sensor.pkl)

Ensemble design:
    3 different algorithms → variance = uncertainty
    If variance > threshold (default 0.15) → requires_human = True
    Alert levels: CLEAR / WATCH / WARNING / DANGER

Usage:
    python ensemble_ml.py                  # Test prediction
    python ensemble_ml.py --demo           # Run demo predictions
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import numpy as np

# ---------------------------------------------------------------------------
# Alert level thresholds (probability-based, matches backend)
# ---------------------------------------------------------------------------
ALERT_THRESHOLDS = {
    "CLEAR": 0.0,
    "WATCH": 0.40,
    "WARNING": 0.60,
    "DANGER": 0.80,
}
UNCERTAINTY_THRESHOLD = 0.15  # Variance threshold for human review

# ---------------------------------------------------------------------------
# NewPhase Model Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).parent
NEWPHASE_DIR = PROJECT_ROOT / "Rapid-Relay-NewPhase" / "flood_preprototype" / "model"

MODEL_PATHS = {
    "lgbm": NEWPHASE_DIR / "flood_lgbm_sensor.pkl",
    "xgboost": NEWPHASE_DIR / "flood_xgb_sensor.pkl",
    "random_forest": NEWPHASE_DIR / "flood_rf_sensor.pkl",
}


# ---------------------------------------------------------------------------
# NewPhase Feature Adapter (import or inline)
# ---------------------------------------------------------------------------
def get_newphase_adapter():
    """Import the NewPhase adapter from backend."""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / "backend"))
        from app.services.newphase_adapter import (
            build_realtime_features,
            SENSOR_FEATURE_COLUMNS,
        )
        return build_realtime_features, SENSOR_FEATURE_COLUMNS
    except ImportError:
        return None, None


# ---------------------------------------------------------------------------
# EnsembleML class (NewPhase version)
# ---------------------------------------------------------------------------
class EnsembleML:
    """
    3-model ensemble using NewPhase trained models.
    Uncertainty = variance across 3 different algorithms.
    """

    def __init__(self) -> None:
        self.models: dict[str, Any] = {}
        self.loaded = False
        self._feature_columns: list[str] = []

    def load(self) -> bool:
        """Load NewPhase models. Returns True if at least one model loaded."""
        try:
            import joblib
        except ImportError:
            print("[EnsembleML] ERROR: pip install joblib", file=sys.stderr)
            return False

        loaded_count = 0
        for name, path in MODEL_PATHS.items():
            if path.exists():
                try:
                    artifact = joblib.load(str(path))

                    # NewPhase models are stored as dicts with 'model' key
                    if isinstance(artifact, dict) and "model" in artifact:
                        self.models[name] = artifact["model"]
                        if "feature_columns" in artifact and not self._feature_columns:
                            self._feature_columns = artifact["feature_columns"]
                    else:
                        self.models[name] = artifact

                    loaded_count += 1
                    print(f"[EnsembleML] Loaded {name} from {path}")
                except Exception as e:
                    print(f"[EnsembleML] Failed to load {name}: {e}", file=sys.stderr)

        self.loaded = loaded_count > 0

        # Get feature columns from adapter if not from model
        if not self._feature_columns:
            _, cols = get_newphase_adapter()
            if cols:
                self._feature_columns = cols

        return self.loaded

    def predict_from_features(self, features: dict[str, float]) -> dict[str, Any]:
        """
        Run ensemble prediction from pre-computed feature dict.

        Args:
            features: Dict of 40 NewPhase sensor features

        Returns:
            {mean_prob, variance, alert_level, requires_human, model_probs}
        """
        if not self.loaded:
            if not self.load():
                return self._fallback_prediction(features)

        # Build feature vector
        adapter, cols = get_newphase_adapter()
        if cols:
            feature_cols = cols
        elif self._feature_columns:
            feature_cols = self._feature_columns
        else:
            return self._fallback_prediction(features)

        X = np.array([[features.get(col, 0.0) for col in feature_cols]])

        # Get predictions from all loaded models
        probs = []
        model_results = {}
        for name, model in self.models.items():
            try:
                prob = float(model.predict_proba(X)[0][1])  # P(flood)
                probs.append(prob)
                model_results[name] = prob
            except Exception as e:
                print(f"[EnsembleML] {name} prediction failed: {e}", file=sys.stderr)

        if not probs:
            return self._fallback_prediction(features)

        # Ensemble statistics
        mean_prob = float(np.mean(probs))
        variance = float(np.var(probs))

        # Classify alert level
        alert_level = self._classify_alert(mean_prob)

        # Flag for human review if high uncertainty
        requires_human = variance > UNCERTAINTY_THRESHOLD

        return {
            "mean_prob": round(mean_prob, 4),
            "variance": round(variance, 4),
            "alert_level": alert_level,
            "requires_human": requires_human,
            "model_probs": model_results,
            "model_count": len(probs),
        }

    def predict_from_buffer(self, sensor_buffer: list[dict], freq: str = "1h") -> dict[str, Any]:
        """
        Run ensemble prediction from sensor buffer.

        Args:
            sensor_buffer: List of sensor readings with water_level, humidity, soil_moisture
            freq: Data frequency ('1h', '15min', etc.)

        Returns:
            Same as predict_from_features
        """
        adapter, _ = get_newphase_adapter()
        if adapter is None:
            return {
                "mean_prob": 0.0,
                "variance": 0.0,
                "alert_level": "CLEAR",
                "requires_human": False,
                "error": "NewPhase adapter not available",
            }

        features = adapter(sensor_buffer, freq=freq)
        if features is None:
            return {
                "mean_prob": 0.0,
                "variance": 0.0,
                "alert_level": "CLEAR",
                "requires_human": False,
                "error": "Insufficient data for feature engineering",
            }

        return self.predict_from_features(features)

    def _classify_alert(self, prob: float) -> str:
        """Classify flood probability into alert level."""
        if prob >= ALERT_THRESHOLDS["DANGER"]:
            return "DANGER"
        elif prob >= ALERT_THRESHOLDS["WARNING"]:
            return "WARNING"
        elif prob >= ALERT_THRESHOLDS["WATCH"]:
            return "WATCH"
        return "CLEAR"

    def _fallback_prediction(self, features: dict[str, float]) -> dict[str, Any]:
        """Rule-based fallback when no models are available."""
        # Use water level feature if available
        wl = features.get("max_waterlevel_24h", 0.0)

        if wl >= 2.5:
            return {"mean_prob": 0.9, "variance": 0.0, "alert_level": "DANGER",
                    "requires_human": True, "method": "fallback"}
        elif wl >= 2.0:
            return {"mean_prob": 0.7, "variance": 0.0, "alert_level": "WARNING",
                    "requires_human": True, "method": "fallback"}
        elif wl >= 1.5:
            return {"mean_prob": 0.5, "variance": 0.0, "alert_level": "WATCH",
                    "requires_human": False, "method": "fallback"}
        return {"mean_prob": 0.2, "variance": 0.0, "alert_level": "CLEAR",
                "requires_human": False, "method": "fallback"}


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------
_ensemble: EnsembleML | None = None


def get_ensemble() -> EnsembleML:
    global _ensemble
    if _ensemble is None:
        _ensemble = EnsembleML()
        _ensemble.load()
    return _ensemble


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RapidRelay Ensemble ML (NewPhase)")
    parser.add_argument("--demo", action="store_true", help="Run demo predictions")
    args = parser.parse_args()

    ensemble = EnsembleML()
    if not ensemble.load():
        print("[EnsembleML] No NewPhase models found!")
        print(f"Expected models in: {NEWPHASE_DIR}")
        sys.exit(1)

    print(f"\n[EnsembleML] Loaded {len(ensemble.models)} models: {list(ensemble.models.keys())}")

    if args.demo:
        import random
        from datetime import datetime, timezone
        import pandas as pd

        print("\n" + "=" * 60)
        print("  EnsembleML Demo — NewPhase Integration")
        print("=" * 60)

        # Generate synthetic 72-hour buffer
        buffer = []
        base_time = datetime.now(timezone.utc)
        for i in range(72):
            buffer.append({
                "timestamp": (base_time - pd.Timedelta(hours=71 - i)).isoformat(),
                "water_level": 1.0 + random.uniform(-0.5, 1.0),
                "humidity": 70 + random.uniform(-10, 20),
                "soil_moisture": 0.3 + random.uniform(0, 0.3),
            })

        result = ensemble.predict_from_buffer(buffer, freq="1h")
        print(f"\nPrediction Result:")
        print(f"  Mean Probability: {result['mean_prob']}")
        print(f"  Variance: {result['variance']}")
        print(f"  Alert Level: {result['alert_level']}")
        print(f"  Requires Human: {result['requires_human']}")
        if "model_probs" in result:
            print(f"  Model Probs: {result['model_probs']}")
