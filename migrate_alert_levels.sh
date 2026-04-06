#!/bin/bash
# =============================================================================
# RapidRelay — Fix Alert Level Validation (Data Migration)
#
# Fixes the offline_buffer constraint violation by clearing unparseable
# payloads that were buffered with old alert_level values.
#
# After this migration, all new readings will use:
#   alert_level IN ('NORMAL','WATCH','WARNING','EMERGENCY')
#
# Usage:
#   chmod +x migrate_alert_levels.sh
#   ./migrate_alert_levels.sh
# =============================================================================

DB_PATH="${LOCAL_DB_PATH:-/home/rapidrelay/db/local.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "[!] Database not found at $DB_PATH"
    echo "    Set LOCAL_DB_PATH in .env or run from RapidRelay root directory"
    exit 1
fi

echo "========================================================"
echo "  RapidRelay — Alert Level Data Migration"
echo "========================================================"
echo ""

# Get counts before
BEFORE_BUFFER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offline_buffer;")
BEFORE_INVALID=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM readings_local WHERE alert_level NOT IN ('NORMAL','WATCH','WARNING','EMERGENCY') OR alert_level IS NULL;")

echo "[→] Current state:"
echo "    Offline buffer records: $BEFORE_BUFFER"
echo "    Invalid readings: $BEFORE_INVALID"
echo ""

# Clear unparseable payloads from before the fix
if [ "$BEFORE_BUFFER" -gt 0 ]; then
    echo "[→] Clearing $BEFORE_BUFFER unparseable payloads from offline_buffer..."
    sqlite3 "$DB_PATH" "DELETE FROM offline_buffer;"
    echo "[✓] Offline buffer cleared"
fi

# Fix any invalid alert_level values (set to NORMAL)
if [ "$BEFORE_INVALID" -gt 0 ]; then
    echo "[→] Fixing $BEFORE_INVALID invalid alert_level values..."
    sqlite3 "$DB_PATH" "UPDATE readings_local SET alert_level='NORMAL' WHERE alert_level NOT IN ('NORMAL','WATCH','WARNING','EMERGENCY') OR alert_level IS NULL;"
    echo "[✓] Invalid alert levels normalized to NORMAL"
fi

# Verify
AFTER_BUFFER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offline_buffer;")
AFTER_INVALID=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM readings_local WHERE alert_level NOT IN ('NORMAL','WATCH','WARNING','EMERGENCY') OR alert_level IS NULL;")

echo ""
echo "  After migration:"
echo "    Offline buffer records: $AFTER_BUFFER"
echo "    Invalid readings: $AFTER_INVALID"
echo ""

if [ "$AFTER_INVALID" -eq 0 ]; then
    echo "[✓] Migration successful — all alert levels are now valid"
    echo ""
    echo "  Next steps:"
    echo "    1. Restart services: ./kill.sh && ./start.sh --no-docker"
    echo "    2. New readings will sync properly to Supabase"
    echo "    3. Check sync: tail -f logs/sync_engine.log"
    echo ""
    echo "========================================================"
    exit 0
else
    echo "[!] Migration incomplete — $AFTER_INVALID invalid records remain"
    echo "========================================================"
    exit 1
fi
