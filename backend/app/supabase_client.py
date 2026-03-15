# =============================================================================
# RapidRelay – Supabase Client (Service Role)
#
# Uses the service role key to bypass RLS for server-side writes
# (sensor readings, predictions). Never expose this key to the frontend.
# =============================================================================

import logging
from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

logger = logging.getLogger("rapidrelay.supabase")

_client: Client | None = None


def get_supabase() -> Client | None:
    """Return the Supabase client singleton, or None if not configured."""
    global _client
    if _client is not None:
        return _client
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        logger.warning("Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_KEY)")
        return None
    _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    logger.info("Supabase client initialized (%s)", SUPABASE_URL[:40])
    return _client
