# =============================================================================
# RapidRelay – Alert Router
# =============================================================================

import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from app.models.schemas import AlertTrigger, AlertResponse
from app.supabase_client import get_supabase

logger = logging.getLogger("rapidrelay.alerts")
router = APIRouter()


@router.post("/trigger", response_model=AlertResponse)
async def trigger_alert(payload: AlertTrigger):
    """Manually trigger an alert broadcast.

    Persists to Supabase and returns a confirmation.
    Phase 2: integrates with Twilio SMS, physical sirens, etc.
    """
    alert_id = f"alert_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)

    # Persist to Supabase
    sb = get_supabase()
    if sb:
        try:
            sb.table("alerts").insert({
                "alert_level": payload.level.value.lower(),
                "title": f"Manual {payload.level.value} Alert",
                "message": payload.message,
                "source": "manual",
                "channels_sent": payload.channels,
            }).execute()
        except Exception as e:
            logger.warning("Failed to persist alert to Supabase: %s", e)

    logger.info("[ALERT] %s | Level: %s | %s", now.isoformat(), payload.level.value, payload.message)

    return AlertResponse(
        success=True,
        alert_id=alert_id,
        message=payload.message,
        channels_sent=payload.channels,
        timestamp=now,
    )
