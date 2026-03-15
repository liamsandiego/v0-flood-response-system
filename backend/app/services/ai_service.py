# =============================================================================
# RapidRelay – AI Interpretation Service (Groq)
#
# Uses Groq's fast LLM inference to generate human-readable flood risk
# interpretation from ML predictions and live sensor data.
# =============================================================================

import json
import logging
from datetime import datetime, timezone

from groq import Groq

from app.config import GROQ_API_KEY, GROQ_MODEL
from app.services.prediction_service import prediction_service
from app.services.simulator import simulator

logger = logging.getLogger("rapidrelay.ai")

SYSTEM_PROMPT = """You are the AI analyst for RAPID RELAY, a hyper-localized flood early warning system deployed in Obando, Bulacan, Philippines.

You receive real-time sensor data from 5 IoT nodes and ML flood predictions (XGBoost model trained on 9 years of environmental data). Your job is to provide a concise, actionable flood risk interpretation for emergency responders and barangay officials.

Guidelines:
- Be direct and concise. Use 2-4 short paragraphs max.
- Start with the current alert level and flood probability in bold.
- Explain what the sensor readings mean in plain language.
- If flood risk is elevated, explain WHY (which sensors are concerning).
- Include specific recommended actions based on alert level:
  - CLEAR: Routine monitoring, no action needed.
  - WATCH: Increased monitoring frequency, prepare evacuation routes.
  - WARNING: Alert barangay officials, pre-position rescue equipment, warn residents near waterways.
  - DANGER: Immediate evacuation of flood-prone barangays, activate emergency response.
- Reference specific sensor locations by name when relevant.
- Keep timestamps in Philippine Time (PHT, UTC+8).
- Do NOT use markdown headers. Use bold (**text**) sparingly for emphasis."""


def _build_context() -> dict:
    """Gather current sensor data + ML prediction into a context dict."""
    prediction = prediction_service.predict()
    status = simulator.get_status()
    readings = simulator.latest_readings if hasattr(simulator, "latest_readings") else []

    # Get latest tick readings from simulator
    if not readings:
        try:
            readings = simulator.tick()
        except Exception:
            readings = []

    sensor_summary = []
    for r in readings:
        sensor_summary.append({
            "sensor_id": r.get("sensor_id", ""),
            "name": r.get("name", ""),
            "water_level_m": r.get("water_level"),
            "rainfall_mm_h": r.get("rainfall"),
            "humidity_pct": r.get("humidity"),
            "soil_moisture_pct": r.get("soil_moisture"),
            "temperature_c": r.get("temperature"),
            "is_valid": r.get("is_valid", True),
        })

    now_pht = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return {
        "timestamp": now_pht,
        "prediction": prediction,
        "sensors": sensor_summary,
        "simulator_status": {
            "flood_mode": status.get("flood_mode", False),
            "flood_ticks_remaining": status.get("flood_ticks_remaining", 0),
        },
    }


def interpret() -> dict:
    """Generate AI interpretation of current flood situation."""
    if not GROQ_API_KEY:
        return {
            "interpretation": "AI interpretation unavailable — GROQ_API_KEY not configured.",
            "model": None,
            "error": True,
        }

    context = _build_context()

    user_message = f"""Current situation as of {context['timestamp']}:

**ML Prediction:**
- Flood probability: {context['prediction']['flood_probability']:.1%}
- Alert level: {context['prediction']['alert_level']}
- Method: {context['prediction']['method']}
- Features: {json.dumps(context['prediction'].get('features_used', {}), indent=2)}

**Live Sensor Readings (5 IoT nodes in Obando, Bulacan):**
{json.dumps(context['sensors'], indent=2)}

**Simulator status:** Flood event active = {context['simulator_status']['flood_mode']}

Provide your flood risk interpretation and recommended actions."""

    try:
        client = Groq(api_key=GROQ_API_KEY)
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.3,
            max_completion_tokens=1024,
        )

        text = completion.choices[0].message.content or ""
        return {
            "interpretation": text.strip(),
            "model": GROQ_MODEL,
            "prediction": context["prediction"],
            "timestamp": context["timestamp"],
            "error": False,
        }

    except Exception as e:
        logger.error("Groq API error: %s", e)
        return {
            "interpretation": f"AI interpretation failed: {str(e)}",
            "model": GROQ_MODEL,
            "prediction": context["prediction"],
            "timestamp": context["timestamp"],
            "error": True,
        }
