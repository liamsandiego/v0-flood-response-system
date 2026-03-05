# =============================================================================
# RapidRelay – Alert Router
# =============================================================================

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from app.models.schemas import AlertTrigger, AlertResponse

router = APIRouter()


@router.post("/trigger", response_model=AlertResponse)
async def trigger_alert(payload: AlertTrigger):
    """Manually trigger an alert broadcast.

    Phase 1: logs the alert and returns a confirmation.
    Phase 2: integrates with Twilio SMS, physical sirens, etc.
    """
    alert_id = f"alert_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)

    # In production this would dispatch to SMS gateway, sirens, etc.
    print(f"[ALERT] {now.isoformat()} | Level: {payload.level.value} | {payload.message}")
    print(f"        Channels: {', '.join(payload.channels)}")

    return AlertResponse(
        success=True,
        alert_id=alert_id,
        message=payload.message,
        channels_sent=payload.channels,
        timestamp=now,
    )
