# =============================================================================
# RapidRelay – Predictions Router
#
# Exposes ML flood prediction results and model status.
# =============================================================================

from fastapi import APIRouter
from app.services.prediction_service import prediction_service

router = APIRouter()


@router.get("/current")
async def get_current_prediction():
    """Get the latest flood prediction from the ML model."""
    return prediction_service.predict()


@router.get("/status")
async def get_model_status():
    """Get ML model status and metadata."""
    return prediction_service.get_status()
