#!/usr/bin/env python3
"""
RapidRelay — Fix Alert Level Validation (Data Migration)

Fixes the offline_buffer constraint violation by clearing unparseable
payloads that were buffered with old alert_level values.

After this migration, all new readings will use:
  alert_level IN ('NORMAL','WATCH','WARNING','EMERGENCY')

Usage:
    python migrate_alert_levels.py
"""

import os
import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from data_layer import DataLayer
except ImportError:
    print("[!] data_layer.py not found in RapidRelay root")
    sys.exit(1)

def main():
    print("=" * 60)
    print("  RapidRelay — Alert Level Data Migration")
    print("=" * 60)
    print()

    try:
        db = DataLayer()
        conn = db._get()  # Get internal connection

        # Get counts before
        cursor = conn.execute("SELECT COUNT(*) FROM offline_buffer")
        before_buffer = cursor.fetchone()[0]

        cursor = conn.execute(
            "SELECT COUNT(*) FROM readings_local WHERE alert_level NOT IN ('NORMAL','WATCH','WARNING','EMERGENCY') OR alert_level IS NULL"
        )
        before_invalid = cursor.fetchone()[0]

        print("[→] Current state:")
        print(f"    Offline buffer records: {before_buffer}")
        print(f"    Invalid readings: {before_invalid}")
        print()

        # Clear unparseable payloads from before the fix
        if before_buffer > 0:
            print(f"[→] Clearing {before_buffer} unparseable payloads from offline_buffer...")
            conn.execute("DELETE FROM offline_buffer")
            conn.commit()
            print("[✓] Offline buffer cleared")

        # Fix any invalid alert_level values (set to NORMAL)
        if before_invalid > 0:
            print(f"[→] Fixing {before_invalid} invalid alert_level values...")
            conn.execute(
                "UPDATE readings_local SET alert_level='NORMAL' WHERE alert_level NOT IN ('NORMAL','WATCH','WARNING','EMERGENCY') OR alert_level IS NULL"
            )
            conn.commit()
            print("[✓] Invalid alert levels normalized to NORMAL")

        # Verify
        cursor = conn.execute("SELECT COUNT(*) FROM offline_buffer")
        after_buffer = cursor.fetchone()[0]

        cursor = conn.execute(
            "SELECT COUNT(*) FROM readings_local WHERE alert_level NOT IN ('NORMAL','WATCH','WARNING','EMERGENCY') OR alert_level IS NULL"
        )
        after_invalid = cursor.fetchone()[0]

        print()
        print("  After migration:")
        print(f"    Offline buffer records: {after_buffer}")
        print(f"    Invalid readings: {after_invalid}")
        print()

        if after_invalid == 0:
            print("[✓] Migration successful — all alert levels are now valid")
            print()
            print("  Next steps:")
            print("    1. Restart services: ./kill.sh && ./start.sh --no-docker")
            print("    2. New readings will sync properly to Supabase")
            print("    3. Check sync: tail -f logs/sync_engine.log")
            print()
            print("=" * 60)
            return 0
        else:
            print(f"[!] Migration incomplete — {after_invalid} invalid records remain")
            print("=" * 60)
            return 1

    except Exception as e:
        print(f"[!] Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        try:
            db.close()
        except:
            pass

if __name__ == "__main__":
    sys.exit(main())
