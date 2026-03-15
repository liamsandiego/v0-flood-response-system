# =============================================================================
# RapidRelay – AI Interpretation Router
#
# Exposes AI-powered flood risk interpretation via Groq LLM.
# =============================================================================

from fastapi import APIRouter
from app.services.ai_service import interpret

router = APIRouter()


@router.get("/interpret")
async def get_interpretation():
    """Get AI interpretation of current flood situation."""
    return interpret()
