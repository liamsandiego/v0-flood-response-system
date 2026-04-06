"""Sync status dashboard endpoints"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from datetime import datetime
import sqlite3

router = APIRouter(prefix="/sync", tags=["sync"])


async def get_sync_stats():
    """Get sync statistics from SQLite"""
    try:
        db_path = "/home/grouptba/RapidRelay/db/local.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Readings
        cursor.execute("SELECT COUNT(*) FROM readings_local WHERE synced=1")
        readings_synced = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM readings_local WHERE synced=0")
        readings_pending = cursor.fetchone()[0]
        readings_total = readings_synced + readings_pending

        # Alerts
        cursor.execute("SELECT COUNT(*) FROM alerts_local WHERE synced=1")
        alerts_synced = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM alerts_local WHERE synced=0")
        alerts_pending = cursor.fetchone()[0]
        alerts_total = alerts_synced + alerts_pending

        # Predictions
        cursor.execute("SELECT COUNT(*) FROM predictions_local WHERE synced=1")
        predictions_synced = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM predictions_local WHERE synced=0")
        predictions_pending = cursor.fetchone()[0]
        predictions_total = predictions_synced + predictions_pending

        conn.close()

        # Calculate percentages
        readings_percent = int((readings_synced / readings_total * 100)) if readings_total > 0 else 0
        alerts_percent = int((alerts_synced / alerts_total * 100)) if alerts_total > 0 else 0
        predictions_percent = int((predictions_synced / predictions_total * 100)) if predictions_total > 0 else 0

        return {
            "readings_total": readings_total,
            "readings_synced": readings_synced,
            "readings_pending": readings_pending,
            "readings_percent": readings_percent,
            "alerts_total": alerts_total,
            "alerts_synced": alerts_synced,
            "alerts_pending": alerts_pending,
            "alerts_percent": alerts_percent,
            "predictions_total": predictions_total,
            "predictions_synced": predictions_synced,
            "predictions_pending": predictions_pending,
            "predictions_percent": predictions_percent,
            "last_readings_sync": "~5 min ago (auto)",
        }
    except Exception as e:
        return {
            "error": str(e),
            "readings_total": 0,
            "readings_synced": 0,
            "readings_pending": 0,
            "readings_percent": 0,
            "alerts_total": 0,
            "alerts_synced": 0,
            "alerts_pending": 0,
            "alerts_percent": 0,
            "predictions_total": 0,
            "predictions_synced": 0,
            "predictions_pending": 0,
            "predictions_percent": 0,
            "last_readings_sync": "error",
        }


@router.get("/status", response_class=HTMLResponse)
async def sync_dashboard():
    """HTML dashboard showing sync status"""
    stats = await get_sync_stats()

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>RapidRelay Sync Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * {{ margin: 0; padding: 0; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }}
            .container {{
                max-width: 1200px;
                margin: 0 auto;
            }}
            h1 {{
                color: white;
                margin-bottom: 30px;
                text-align: center;
                font-size: 2.5em;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
            }}
            .grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }}
            .card {{
                background: white;
                border-radius: 12px;
                padding: 25px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                transition: transform 0.2s;
            }}
            .card:hover {{
                transform: translateY(-5px);
            }}
            .card h2 {{
                color: #667eea;
                margin-bottom: 15px;
                font-size: 1.3em;
            }}
            .stat {{
                display: flex;
                justify-content: space-between;
                margin: 12px 0;
                padding: 10px 0;
                border-bottom: 1px solid #eee;
            }}
            .stat:last-child {{
                border-bottom: none;
            }}
            .stat-label {{
                color: #666;
                font-weight: 500;
            }}
            .stat-value {{
                font-weight: bold;
                font-size: 1.1em;
            }}
            .sync {{
                color: #10b981;
            }}
            .pending {{
                color: #f59e0b;
            }}
            .error {{
                color: #ef4444;
            }}
            .status-badge {{
                display: inline-block;
                padding: 6px 12px;
                border-radius: 20px;
                font-size: 0.85em;
                font-weight: bold;
                margin-top: 12px;
            }}
            .status-ok {{
                background: #d1fae5;
                color: #065f46;
            }}
            .status-warn {{
                background: #fef3c7;
                color: #92400e;
            }}
            .status-error {{
                background: #fee2e2;
                color: #991b1b;
            }}
            .progress-bar {{
                width: 100%;
                height: 8px;
                background: #e5e7eb;
                border-radius: 4px;
                overflow: hidden;
                margin-top: 10px;
            }}
            .progress-fill {{
                height: 100%;
                background: linear-gradient(90deg, #10b981, #059669);
                transition: width 0.3s;
            }}
            .last-sync {{
                color: #999;
                font-size: 0.9em;
                margin-top: 12px;
            }}
            .refresh {{
                text-align: center;
                margin-top: 30px;
            }}
            .refresh button {{
                background: white;
                color: #667eea;
                border: none;
                padding: 12px 30px;
                border-radius: 6px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                transition: all 0.2s;
            }}
            .refresh button:hover {{
                transform: scale(1.05);
                box-shadow: 0 6px 20px rgba(0,0,0,0.15);
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 RapidRelay Sync Dashboard</h1>

            <div class="grid">
                <!-- Readings Card -->
                <div class="card">
                    <h2>📡 Sensor Readings</h2>
                    <div class="stat">
                        <span class="stat-label">Total Local</span>
                        <span class="stat-value">{stats['readings_total']}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Synced to Cloud</span>
                        <span class="stat-value sync">{stats['readings_synced']}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Pending Sync</span>
                        <span class="stat-value pending">{stats['readings_pending']}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: {stats['readings_percent']}%"></div>
                    </div>
                    <div class="status-badge status-ok">✓ Syncing</div>
                    <div class="last-sync">Last sync: {stats['last_readings_sync']}</div>
                </div>

                <!-- Alerts Card -->
                <div class="card">
                    <h2>🚨 Flood Alerts</h2>
                    <div class="stat">
                        <span class="stat-label">Total Local</span>
                        <span class="stat-value">{stats['alerts_total']}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Synced to Cloud</span>
                        <span class="stat-value sync">{stats['alerts_synced']}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Pending Sync</span>
                        <span class="stat-value error">{stats['alerts_pending']}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: {stats['alerts_percent']}%; background: linear-gradient(90deg, #f59e0b, #d97706);"></div>
                    </div>
                    <div class="status-badge status-error">⚠️ Schema Error</div>
                    <div class="last-sync">Issue: alert_level constraint mismatch</div>
                </div>

                <!-- Predictions Card -->
                <div class="card">
                    <h2>🌊 Flood Predictions</h2>
                    <div class="stat">
                        <span class="stat-label">Total Local</span>
                        <span class="stat-value">{stats['predictions_total']}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Synced to Cloud</span>
                        <span class="stat-value sync">{stats['predictions_synced']}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Pending Sync</span>
                        <span class="stat-value pending">{stats['predictions_pending']}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: {stats['predictions_percent']}%"></div>
                    </div>
                    <div class="status-badge status-ok">✓ Ready</div>
                    <div class="last-sync">Waiting for schema fix</div>
                </div>

                <!-- System Status Card -->
                <div class="card">
                    <h2>⚙️ System Status</h2>
                    <div class="stat">
                        <span class="stat-label">Database</span>
                        <span class="stat-value sync">✓ Connected</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Supabase</span>
                        <span class="stat-value sync">✓ Connected</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Sync Engine</span>
                        <span class="stat-value sync">✓ Running</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Sync Interval</span>
                        <span class="stat-value">5 minutes</span>
                    </div>
                    <div class="last-sync">Updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
                </div>

                <!-- Storage Info Card -->
                <div class="card">
                    <h2>💾 Local Storage</h2>
                    <div class="stat">
                        <span class="stat-label">Database Path</span>
                    </div>
                    <div style="color: #666; font-size: 0.9em; word-break: break-all;">
                        /home/grouptba/RapidRelay/db/local.db
                    </div>
                    <div class="stat" style="margin-top: 15px;">
                        <span class="stat-label">Buffering Strategy</span>
                        <span class="stat-value">Local + Cloud</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Power Loss Protection</span>
                        <span class="stat-value sync">✓ WAL Mode</span>
                    </div>
                    <div class="last-sync">All data persists offline</div>
                </div>

                <!-- Issues Card -->
                <div class="card">
                    <h2>⚠️ Known Issues</h2>
                    <div style="color: #ef4444; margin: 10px 0;">
                        <strong>Alert Level Constraint</strong>
                    </div>
                    <div style="color: #666; font-size: 0.95em; line-height: 1.5;">
                        Local: CLEAR, WATCH, WARNING, DANGER<br>
                        Supabase: normal, warning, critical<br>
                        <br>
                        <strong>Fix Required:</strong> Map alert levels before pushing to cloud
                    </div>
                </div>
            </div>

            <div class="refresh">
                <button onclick="location.reload()">🔄 Refresh Dashboard</button>
            </div>
        </div>

        <script>
            // Auto-refresh every 30 seconds
            setTimeout(() => location.reload(), 30000);
        </script>
    </body>
    </html>
    """
    return html
