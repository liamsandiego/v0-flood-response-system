"""
backend/app/services/woody_local.py — Ollama local AI explanation
RapidRelay / Obando Flood Early Warning System

Role: EXPLAIN only, never VALIDATE.
Advisory — tells LDRRMO operators what might be happening, not "valid/invalid".
"""

from __future__ import annotations

import json
import logging
from typing import Any

import requests

logger = logging.getLogger("woody_local")

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2:3b"
TIMEOUT_S = 15


def explain_reading(reading_m: float, context: dict[str, Any]) -> dict[str, Any] | None:
    """
    Advisory explanation for a water level reading.

    Args:
        reading_m: validated water level in meters
        context: dict with keys: tide, rain, history (list of floats), sentinel_age

    Returns:
        {"possibilities": [str, str, str], "sentinel_disagreement": bool}
        or None if Ollama is offline (never blocks the pipeline).
    """
    tide = context.get("tide", "N/A")
    rain = context.get("rain", 0)
    sentinel_age = context.get("sentinel_age", "unknown")
    history = context.get("history", [])

    history_str = (
        " → ".join(f"{v:.2f}m" for v in history[-12:])
        if history else "unavailable"
    )

    prompt = f"""You are a hydrology assistant for Obando, Bulacan.

HARD DATA (verify before using):
- Sensor reading: {reading_m:.3f}m
- Tide: {tide}m
- Rain: {rain}mm/hr
- Sentinel-1 last pass: {sentinel_age}h ago
- History (oldest→newest): {history_str}

TASK: List 3 possibilities for this reading:
1. Most likely physical cause if the reading is accurate
2. Most likely sensor malfunction if the reading is inaccurate
3. Worst-case scenario if the reading is true

RULES:
- Do NOT say "valid" or "invalid"
- Do NOT give confidence percentages
- Flag if Sentinel-1 data contradicts the sensor reading

Output JSON only: {{"possibilities": ["<cause>", "<malfunction>", "<worst_case>"], "sentinel_disagreement": false}}"""

    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.3, "num_predict": 256},
            },
            timeout=TIMEOUT_S,
        )
        response.raise_for_status()
        raw = response.json().get("response", "{}")
        result = json.loads(raw)
        return {
            "possibilities": result.get("possibilities", [])[:3],
            "sentinel_disagreement": bool(result.get("sentinel_disagreement", False)),
        }
    except requests.exceptions.Timeout:
        logger.warning("[Woody] Ollama timeout after %ds — skipping explanation", TIMEOUT_S)
        return None
    except requests.exceptions.ConnectionError:
        logger.warning("[Woody] Ollama not running at %s — AI offline", OLLAMA_URL)
        return None
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning("[Woody] Response parse error: %s", e)
        return None
    except Exception as e:
        logger.error("[Woody] Unexpected error: %s", e)
        return None
