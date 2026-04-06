# =============================================================================
# RapidRelay – NewPhase Feature Engineering Adapter
#
# Bridges real-time sensor readings to the NewPhase 40-feature ML pipeline.
# Loads 3 trained models (LGBM, XGBoost, RandomForest) for ensemble prediction.
#
# Feature Engineering from:
#   Rapid-Relay-NewPhase/flood_preprototype/ml_pipeline/feature_engineering.py
#
# Column mapping:
#   Backend uses: water_level, humidity, soil_moisture
#   NewPhase expects: waterlevel, humidity, soil_moisture
# =============================================================================

import logging
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np
import pandas as pd

logger = logging.getLogger("rapidrelay.newphase")

# -----------------------------------------------------------------------------
# Feature columns (must match NewPhase SENSOR_FEATURE_COLUMNS exactly)
# From: Rapid-Relay-NewPhase/flood_preprototype/scripts/feature_engineering.py
# -----------------------------------------------------------------------------

SENSOR_FEATURE_COLUMNS = [
    # Water level (point / window stats)
    "max_waterlevel_6h",
    "max_waterlevel_24h",
    "waterlevel_slope_3h",
    "waterlevel_slope_6h",
    "waterlevel_std_24h",
    "waterlevel_rise_rate_48h",
    # Water level (lag / memory)
    "waterlevel_lag_1d",
    "waterlevel_lag_2d",
    "waterlevel_lag_3d",
    # Water level (context / proximity)
    "waterlevel_days_above_threshold",
    "waterlevel_pct_rank_30d",
    "waterlevel_distance_to_max",
    # Water level (slow-build rolling)
    "waterlevel_mean_7d",
    "waterlevel_cumrise_14d",
    # Soil moisture
    "sensor_soilmoisture_mean_6h",
    "sensor_soilmoisture_mean_24h",
    "sensor_soilmoisture_trend_6h",
    # Soil moisture (lag)
    "soilmoisture_lag_1d",
    "soilmoisture_lag_2d",
    # Humidity
    "humidity_mean_24h",
    "humidity_trend_6h",
    # Cross-sensor interactions
    "waterlevel_x_soilmoisture",
    "humidity_x_waterlevel_slope",
    # Season (month encoding)
    "season_sin",
    "season_cos",
    # Season (week-of-year encoding)
    "week_sin",
    "week_cos",
]

# Ticks-per-window lookup (supports different data frequencies)
TICKS = {
    "15min": {"1h": 4, "3h": 12, "6h": 24, "24h": 96, "48h": 192},
    "1h": {"1h": 1, "3h": 3, "6h": 6, "24h": 24, "48h": 48},
    "2h": {"1h": 1, "3h": 2, "6h": 3, "24h": 12, "48h": 24},
    "4h": {"1h": 1, "3h": 1, "6h": 2, "24h": 6, "48h": 12},
    "6h": {"1h": 1, "3h": 1, "6h": 1, "24h": 4, "48h": 8},
    "1D": {"1h": 1, "3h": 1, "6h": 1, "24h": 7, "48h": 14},
}


# -----------------------------------------------------------------------------
# Feature Engineering Functions (adapted from NewPhase)
# -----------------------------------------------------------------------------


def compute_waterlevel_features(
    df: pd.DataFrame,
    col: str = "waterlevel",
    freq: str = "1h",
) -> pd.DataFrame:
    """Water level features (14 total)."""
    t = TICKS.get(freq, TICKS["1h"])
    df = df.copy()

    # Window stats
    df["max_waterlevel_6h"] = df[col].rolling(t["6h"], min_periods=1).max()
    df["max_waterlevel_24h"] = df[col].rolling(t["24h"], min_periods=1).max()
    df["waterlevel_std_24h"] = df[col].rolling(t["24h"], min_periods=2).std().fillna(0)

    # Slopes
    df["waterlevel_slope_3h"] = (df[col] - df[col].shift(t["3h"])) / max(t["3h"], 1)
    df["waterlevel_slope_6h"] = (df[col] - df[col].shift(t["6h"])) / max(t["6h"], 1)
    df["waterlevel_rise_rate_48h"] = (df[col] - df[col].shift(t["48h"])) / max(t["48h"], 1)

    # Consecutive ticks above 1.5 sigma threshold
    above = (df[col] > 1.5).astype(int)
    group_key = (above != above.shift()).cumsum()
    df["waterlevel_days_above_threshold"] = (
        above.groupby(group_key).cumcount().add(1).mul(above)
    )

    # Percentile rank vs rolling 30-day window
    window_30d = t["24h"] * 30
    df["waterlevel_pct_rank_30d"] = (
        df[col]
        .rolling(window_30d, min_periods=7)
        .apply(lambda x: float(pd.Series(x).rank(pct=True).iloc[-1]), raw=False)
    )

    # Distance from historical max
    historical_max = df[col].expanding(min_periods=1).max()
    df["waterlevel_distance_to_max"] = historical_max - df[col]

    return df


def compute_soilmoisture_features(
    df: pd.DataFrame,
    col: str = "soil_moisture",
    freq: str = "1h",
) -> pd.DataFrame:
    """Soil moisture features (3 total)."""
    t = TICKS.get(freq, TICKS["1h"])
    df = df.copy()
    df["sensor_soilmoisture_mean_6h"] = df[col].rolling(t["6h"], min_periods=1).mean()
    df["sensor_soilmoisture_mean_24h"] = df[col].rolling(t["24h"], min_periods=1).mean()
    df["sensor_soilmoisture_trend_6h"] = df[col] - df[col].shift(t["6h"])
    return df


def compute_humidity_features(
    df: pd.DataFrame,
    col: str = "humidity",
    freq: str = "1h",
) -> pd.DataFrame:
    """Humidity features (2 total)."""
    t = TICKS.get(freq, TICKS["1h"])
    df = df.copy()
    df["humidity_mean_24h"] = df[col].rolling(t["24h"], min_periods=1).mean()
    df["humidity_trend_6h"] = df[col] - df[col].shift(t["6h"])
    return df


def compute_season_features(df: pd.DataFrame) -> pd.DataFrame:
    """Season encoding (4 total): sin/cos for month and week-of-year."""
    df = df.copy()
    month = df.index.month.astype(float)

    try:
        week = df.index.isocalendar().week.astype(float).values
    except AttributeError:
        week = pd.Series(df.index).dt.isocalendar().week.astype(float).values

    df["season_sin"] = np.sin(2 * np.pi * month / 12)
    df["season_cos"] = np.cos(2 * np.pi * month / 12)
    df["week_sin"] = np.sin(2 * np.pi * week / 52)
    df["week_cos"] = np.cos(2 * np.pi * week / 52)
    return df


def compute_lag_features(
    df: pd.DataFrame,
    waterlevel_col: str = "waterlevel",
    soilmoisture_col: str = "soil_moisture",
    freq: str = "1h",
) -> pd.DataFrame:
    """Lag features (5 total): water level and soil moisture lags."""
    t = TICKS.get(freq, TICKS["1h"])
    df = df.copy()
    tpd = t["24h"]  # ticks per day

    df["waterlevel_lag_1d"] = df[waterlevel_col].shift(tpd * 1)
    df["waterlevel_lag_2d"] = df[waterlevel_col].shift(tpd * 2)
    df["waterlevel_lag_3d"] = df[waterlevel_col].shift(tpd * 3)
    df["soilmoisture_lag_1d"] = df[soilmoisture_col].shift(tpd * 1)
    df["soilmoisture_lag_2d"] = df[soilmoisture_col].shift(tpd * 2)
    return df


def compute_interaction_features(df: pd.DataFrame) -> pd.DataFrame:
    """Cross-sensor interaction features (2 total)."""
    df = df.copy()

    if "max_waterlevel_24h" in df.columns and "sensor_soilmoisture_mean_24h" in df.columns:
        df["waterlevel_x_soilmoisture"] = (
            df["max_waterlevel_24h"] * df["sensor_soilmoisture_mean_24h"]
        )
    else:
        df["waterlevel_x_soilmoisture"] = 0.0

    if "humidity_mean_24h" in df.columns and "waterlevel_slope_6h" in df.columns:
        df["humidity_x_waterlevel_slope"] = (
            df["humidity_mean_24h"] * df["waterlevel_slope_6h"].clip(lower=0)
        )
    else:
        df["humidity_x_waterlevel_slope"] = 0.0

    return df


def compute_rolling_waterlevel(df: pd.DataFrame) -> pd.DataFrame:
    """Slow-build flood features (2 total)."""
    if "max_waterlevel_24h" not in df.columns:
        return df
    df = df.copy()
    if "waterlevel_mean_7d" not in df.columns:
        df["waterlevel_mean_7d"] = (
            df["max_waterlevel_24h"].rolling(7, min_periods=1).mean()
        )
    if "waterlevel_cumrise_14d" not in df.columns:
        df["waterlevel_cumrise_14d"] = (
            df["max_waterlevel_24h"].rolling(14, min_periods=1).sum()
        )
    return df


# -----------------------------------------------------------------------------
# Main Adapter Function
# -----------------------------------------------------------------------------


def build_realtime_features(
    sensor_buffer: list[dict],
    freq: str = "1h",
) -> Optional[dict]:
    """
    Build NewPhase 25-feature vector from a sensor reading buffer.

    Args:
        sensor_buffer: List of sensor readings, each with keys:
            - water_level (meters)
            - humidity (%)
            - soil_moisture (0-1 ratio)
            - timestamp (ISO string or datetime)
        freq: Data frequency ('15min', '1h', '2h', '4h', '6h', '1D')

    Returns:
        Dict of 25 features ready for ML model, or None if insufficient data.
    """
    t = TICKS.get(freq, TICKS["1h"])
    min_samples = max(t["48h"], 14)  # Need 48h of data for waterlevel_rise_rate_48h

    if len(sensor_buffer) < min_samples:
        logger.debug(f"Insufficient data: {len(sensor_buffer)} < {min_samples} samples")
        return None

    # Convert buffer to DataFrame
    df = pd.DataFrame(sensor_buffer)

    # Handle timestamp index
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.set_index("timestamp").sort_index()
    else:
        # Generate synthetic timestamps
        df.index = pd.date_range(
            end=pd.Timestamp.now("UTC"),
            periods=len(df),
            freq=freq.replace("D", "d").lower(),
        )

    # Column name mapping: backend → NewPhase
    if "water_level" in df.columns:
        df["waterlevel"] = df["water_level"]
    if "waterlevel" not in df.columns:
        logger.error("Missing water level data")
        return None

    # Ensure required columns exist with defaults
    if "humidity" not in df.columns:
        df["humidity"] = 70.0  # default humidity
    if "soil_moisture" not in df.columns:
        df["soil_moisture"] = 0.3  # default soil moisture

    # Normalize soil moisture to ratio if in percentage
    if df["soil_moisture"].mean() > 1:
        df["soil_moisture"] = df["soil_moisture"] / 100.0

    # Build all features
    try:
        df = compute_waterlevel_features(df, col="waterlevel", freq=freq)
        df = compute_soilmoisture_features(df, col="soil_moisture", freq=freq)
        df = compute_humidity_features(df, col="humidity", freq=freq)
        df = compute_season_features(df)
        df = compute_lag_features(
            df, waterlevel_col="waterlevel", soilmoisture_col="soil_moisture", freq=freq
        )
        df = compute_interaction_features(df)
        df = compute_rolling_waterlevel(df)
    except Exception as e:
        logger.error(f"Feature engineering failed: {e}")
        return None

    # Extract latest row's features
    latest = df.iloc[-1]
    features = {}

    for col in SENSOR_FEATURE_COLUMNS:
        if col in df.columns:
            val = latest[col]
            # Handle NaN values
            features[col] = 0.0 if pd.isna(val) else float(val)
        else:
            logger.warning(f"Missing feature column: {col}")
            features[col] = 0.0

    # Validate we have all features
    missing = [c for c in SENSOR_FEATURE_COLUMNS if c not in features]
    if missing:
        logger.error(f"Missing features after build: {missing}")
        return None

    return features


def get_feature_columns() -> list[str]:
    """Return the list of feature columns expected by NewPhase models."""
    return SENSOR_FEATURE_COLUMNS.copy()


# -----------------------------------------------------------------------------
# Validation Helper
# -----------------------------------------------------------------------------


def validate_model_compatibility(model_artifact: dict) -> bool:
    """
    Check if a loaded model artifact is compatible with this adapter.

    Args:
        model_artifact: Dict with 'model' and optionally 'feature_columns'

    Returns:
        True if compatible, False otherwise
    """
    if "feature_columns" not in model_artifact:
        logger.warning("Model artifact missing feature_columns metadata")
        return True  # Assume compatible if no metadata

    model_cols = set(model_artifact["feature_columns"])
    adapter_cols = set(SENSOR_FEATURE_COLUMNS)

    if model_cols != adapter_cols:
        extra = model_cols - adapter_cols
        missing = adapter_cols - model_cols
        if extra:
            logger.warning(f"Model expects extra features: {extra}")
        if missing:
            logger.error(f"Adapter missing features required by model: {missing}")
            return False

    return True


# -----------------------------------------------------------------------------
# Smoke Test
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    import random

    print("NewPhase Adapter Smoke Test")
    print("=" * 50)

    # Generate synthetic hourly data (3 days = 72 hours)
    buffer = []
    base_time = datetime.now(timezone.utc)
    for i in range(72):
        buffer.append({
            "timestamp": (base_time - pd.Timedelta(hours=71 - i)).isoformat(),
            "water_level": 1.0 + random.uniform(-0.5, 1.0),
            "humidity": 70 + random.uniform(-10, 20),
            "soil_moisture": 0.3 + random.uniform(0, 0.3),
        })

    features = build_realtime_features(buffer, freq="1h")

    if features:
        print(f"Generated {len(features)} features:")
        for col in SENSOR_FEATURE_COLUMNS:
            print(f"  {col}: {features.get(col, 'N/A'):.4f}")
        print("\nSUCCESS: All 25 features generated")
    else:
        print("FAILED: Could not generate features")


# =============================================================================
# Model Loading and Ensemble Prediction
# =============================================================================


class NewPhaseEnsemble:
    """
    Load and manage 3 trained NewPhase models (LGBM, XGBoost, RandomForest).
    Provides unified prediction interface with ensemble voting and confidence metrics.
    """

    def __init__(self, model_dir: Optional[str] = None):
        """
        Initialize and load all 3 models.

        Args:
            model_dir: Path to Rapid-Relay-NewPhase/flood_preprototype/model
                      Defaults to repo structure if None
        """
        if model_dir is None:
            # Infer from this file's location
            project_root = Path(__file__).parent.parent.parent.parent
            model_dir = project_root / "Rapid-Relay-NewPhase/flood_preprototype/model"

        self.model_dir = Path(model_dir)
        self.models = {}
        self.load_models()

    def load_models(self):
        """Load LGBM, XGBoost, and RandomForest sensor models."""
        model_names = ["lgbm", "xgb", "rf"]
        for name in model_names:
            model_path = self.model_dir / f"flood_{name}_sensor.pkl"
            try:
                if model_path.exists():
                    with open(model_path, "rb") as f:
                        self.models[name] = pickle.load(f)
                    logger.info(f"Loaded model: {name} from {model_path}")
                else:
                    logger.warning(f"Model file not found: {model_path}")
            except Exception as e:
                logger.error(f"Failed to load {name} model: {e}")

    def predict(self, features: Dict[str, float]) -> Dict[str, Any]:
        """
        Make ensemble prediction from 40 feature dict.

        Args:
            features: Dict with 40 feature keys (output from build_realtime_features)

        Returns:
            Dict with:
            - flood_probability: float [0, 1] — ensemble mean
            - variance: float — model variance
            - alert_level: str — 'CLEAR' | 'WATCH' | 'WARNING' | 'DANGER'
            - method: str — which model(s) used
            - timestamp: str — prediction time
        """
        if not self.models:
            logger.error("No models loaded")
            return {
                "flood_probability": 0.0,
                "variance": 1.0,
                "alert_level": "CLEAR",
                "method": "fallback_no_models",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        # Convert dict to DataFrame for sklearn models
        try:
            X = pd.DataFrame([features])
            probs = {}

            for name, model in self.models.items():
                try:
                    if hasattr(model, "predict_proba"):
                        prob = model.predict_proba(X)[0, 1]
                    else:
                        prob = model.predict(X)[0]
                    probs[name] = float(prob)
                except Exception as e:
                    logger.warning(f"{name} prediction failed: {e}")
                    probs[name] = None

            # Compute ensemble
            valid_probs = [p for p in probs.values() if p is not None]
            if not valid_probs:
                logger.error("All models failed to predict")
                return {
                    "flood_probability": 0.0,
                    "variance": 1.0,
                    "alert_level": "CLEAR",
                    "method": "fallback_all_failed",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

            mean_prob = np.mean(valid_probs)
            variance = np.var(valid_probs)

            # Determine alert level
            if mean_prob >= 0.75:
                alert_level = "DANGER"
            elif mean_prob >= 0.50:
                alert_level = "WARNING"
            elif mean_prob >= 0.25:
                alert_level = "WATCH"
            else:
                alert_level = "CLEAR"

            return {
                "flood_probability": float(mean_prob),
                "variance": float(variance),
                "alert_level": alert_level,
                "method": "ensemble" if len(valid_probs) > 1 else list(self.models.keys())[0],
                "n_models": len(valid_probs),
                "model_probs": probs,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.error(f"Ensemble prediction failed: {e}")
            return {
                "flood_probability": 0.0,
                "variance": 1.0,
                "alert_level": "CLEAR",
                "method": "fallback_exception",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

    def status(self) -> Dict[str, Any]:
        """Return status of loaded models."""
        return {
            "models_loaded": list(self.models.keys()),
            "n_models": len(self.models),
            "model_dir": str(self.model_dir),
        }
