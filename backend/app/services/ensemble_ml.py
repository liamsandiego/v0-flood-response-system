"""
backend/app/services/ensemble_ml.py — Ensemble ML service wrapper
RapidRelay / Obando Flood Early Warning System

Thin wrapper that delegates to the standalone ensemble_ml.py at project root.
Keeps backend service layer clean — models are shared with the standalone script.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("ensemble_ml_service")

# Add project root to sys.path so we can import standalone ensemble_ml.py
_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_ensemble = None


def _get_ensemble():
    global _ensemble
    if _ensemble is None:
        try:
            from ensemble_ml import EnsembleML
            _ensemble = EnsembleML()
            if not _ensemble.load():
                logger.info("[EnsembleML] No saved models — training now (first run)...")
                _ensemble.train()
            logger.info("[EnsembleML] Ready")
        except ImportError as e:
            logger.warning("[EnsembleML] Import failed: %s — rule-based fallback active", e)
            _ensemble = None
    return _ensemble


def predict(reading: dict[str, Any]) -> dict[str, Any]:
    """
    Run ensemble prediction. Falls back to rule-based thresholds if ML unavailable.

    Returns:
        {mean_prob, variance, alert_level, requires_human, class_probs}
    """
    ensemble = _get_ensemble()
    if ensemble:
        try:
            return ensemble.predict(reading)
        except Exception as e:
            logger.error("[EnsembleML] Prediction error: %s — using rule-based fallback", e)

    # Rule-based fallback (no ML needed)
    wl = reading.get("water_level_m", 0.0)
    if wl >= 3.0:
        level = "EMERGENCY"
    elif wl >= 2.0:
        level = "WARNING"
    elif wl >= 1.5:
        level = "WATCH"
    else:
        level = "NORMAL"

    return {
        "mean_prob": 1.0 if level == "EMERGENCY" else 0.5,
        "variance": 0.0,
        "alert_level": level,
        "requires_human": False,
        "class_probs": {"NORMAL": 0, "WATCH": 0, "WARNING": 0, "EMERGENCY": 0, level: 1.0},
    }
