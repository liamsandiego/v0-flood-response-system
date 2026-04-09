# =============================================================================
# RapidRelay – Backend Sync Validation Dashboard
#
# Compares local persistence tables with Supabase tables for development testing.
# Focus tables:
#   - obando_environmental_data <-> obando_environmental_local
#   - flood_predictions        <-> predictions_local
# =============================================================================

from __future__ import annotations

import html
import os
import sys
from typing import Any

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from data_layer import get_db
from app.supabase_client import get_supabase

router = APIRouter()


def _safe(v: Any) -> str:
    if v is None:
        return ""
    return html.escape(str(v))


def _cloud_columns(sb, table_name: str) -> set[str]:
    try:
        resp = sb.table(table_name).select("*").limit(1).execute()
        data = resp.data or []
        if data:
            return set(data[0].keys())
    except Exception:
        pass
    return set()


def _read_cloud_environmental(sb, limit: int = 100) -> list[dict[str, Any]]:
    cols = _cloud_columns(sb, "obando_environmental_data")
    if not cols:
        return []

    order_col = "timestamp" if "timestamp" in cols else ("id" if "id" in cols else None)
    query = sb.table("obando_environmental_data").select("*")
    if order_col:
        query = query.order(order_col, desc=True)
    response = query.limit(limit).execute()
    return response.data or []


def _read_cloud_predictions(sb, limit: int = 100) -> list[dict[str, Any]]:
    cols = _cloud_columns(sb, "flood_predictions")
    query = sb.table("flood_predictions").select("*")
    for ts_col in ["timestamp", "predicted_at", "created_at", "id"]:
        if ts_col in cols:
            query = query.order(ts_col, desc=True)
            break
    response = query.limit(limit).execute()
    return response.data or []


@router.get("/", response_class=HTMLResponse)
async def sync_dashboard() -> HTMLResponse:
    db = get_db()
    local_env = db.get_environmental_history(limit=100)
    local_preds = db.get_prediction_history(limit=100)
    sync_status = db.get_sync_status()

    cloud_env: list[dict[str, Any]] = []
    cloud_preds: list[dict[str, Any]] = []
    cloud_error = ""

    try:
        sb = get_supabase()
        if sb:
            cloud_env = _read_cloud_environmental(sb, limit=100)
            cloud_preds = _read_cloud_predictions(sb, limit=100)
        else:
            cloud_error = "Supabase credentials not configured."
    except Exception as e:
        cloud_error = str(e)

    env_cloud_rows = ""
    for row in cloud_env[:50]:
        soil = row.get("soil_moisture", row.get("Soil Moisture"))
        temp = row.get("temperature", row.get("Temperature"))
        hum = row.get("humidity", row.get("Humidity"))
        pres = row.get("pressure", row.get("Pressure"))
        dist = row.get("final_distance", row.get("Final Distance", row.get("distance_m")))
        d = row.get("date", row.get("Date"))
        t = row.get("time", row.get("Time"))
        env_cloud_rows += (
            "<tr>"
            f"<td>{_safe(row.get('id'))}</td>"
            f"<td>{_safe(row.get('device', row.get('Device', row.get('sensor_id'))))}</td>"
            f"<td>{_safe(soil)}</td>"
            f"<td>{_safe(temp)}</td>"
            f"<td>{_safe(hum)}</td>"
            f"<td>{_safe(pres)}</td>"
            f"<td>{_safe(dist)}</td>"
            f"<td>{_safe(d)}</td>"
            f"<td>{_safe(t)}</td>"
            "</tr>"
        )

    env_local_rows = ""
    for row in local_env[:50]:
        env_local_rows += (
            "<tr>"
            f"<td>{_safe(row.get('id'))}</td>"
            f"<td>{_safe(row.get('cloud_id'))}</td>"
            f"<td>{_safe(row.get('device') or row.get('sensor_id'))}</td>"
            f"<td>{_safe(row.get('soil_moisture'))}</td>"
            f"<td>{_safe(row.get('temperature'))}</td>"
            f"<td>{_safe(row.get('humidity'))}</td>"
            f"<td>{_safe(row.get('pressure'))}</td>"
            f"<td>{_safe(row.get('final_distance'))}</td>"
            f"<td>{_safe(row.get('record_date'))}</td>"
            f"<td>{_safe(row.get('record_time'))}</td>"
            f"<td>{'YES' if row.get('synced') else 'NO'}</td>"
            "</tr>"
        )

    pred_cloud_rows = ""
    for row in cloud_preds[:50]:
        pred_cloud_rows += (
            "<tr>"
            f"<td>{_safe(row.get('id'))}</td>"
            f"<td>{_safe(row.get('flood_probability'))}</td>"
            f"<td>{_safe(row.get('alert_level', row.get('risk_tier')))}</td>"
            f"<td>{_safe(row.get('timestamp', row.get('predicted_at', row.get('created_at'))))}</td>"
            "</tr>"
        )

    pred_local_rows = ""
    for row in local_preds[:50]:
        pred_local_rows += (
            "<tr>"
            f"<td>{_safe(row.get('id'))}</td>"
            f"<td>{_safe(row.get('cloud_id'))}</td>"
            f"<td>{_safe(row.get('flood_probability'))}</td>"
            f"<td>{_safe(row.get('alert_level'))}</td>"
            f"<td>{_safe(row.get('method'))}</td>"
            f"<td>{_safe(row.get('predicted_at'))}</td>"
            f"<td>{'YES' if row.get('synced') else 'NO'}</td>"
            "</tr>"
        )

    html_content = f"""
    <!DOCTYPE html>
    <html lang=\"en\">
    <head>
      <meta charset=\"UTF-8\" />
      <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
      <title>RapidRelay Sync Validation</title>
      <style>
        :root {{
          --bg: #f6f8f2;
          --panel: #ffffff;
          --ink: #1f2a1f;
          --muted: #657266;
          --brand: #0f766e;
          --brand-2: #b45309;
          --line: #d6ddcf;
          --ok: #15803d;
          --warn: #b45309;
        }}
        * {{ box-sizing: border-box; }}
        body {{
          margin: 0;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          color: var(--ink);
          background:
            radial-gradient(circle at 0% 0%, rgba(15,118,110,0.18), transparent 35%),
            radial-gradient(circle at 100% 100%, rgba(180,83,9,0.16), transparent 40%),
            var(--bg);
          min-height: 100vh;
        }}
        .wrap {{ max-width: 1400px; margin: 24px auto; padding: 0 14px 30px; }}
        .top {{
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 14px;
        }}
        .card {{
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 8px 20px rgba(0,0,0,0.04);
        }}
        h1 {{ margin: 0 0 12px; font-size: 1.4rem; }}
        h2 {{ margin: 0 0 8px; font-size: 1rem; color: var(--brand); }}
        p {{ margin: 2px 0; color: var(--muted); }}
        .value {{ font-size: 1.5rem; font-weight: 700; }}
        .ok {{ color: var(--ok); font-weight: 600; }}
        .warn {{ color: var(--warn); font-weight: 600; }}
        .grid {{
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-top: 12px;
        }}
        .panel-title {{
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }}
        .meta {{ font-size: 0.85rem; color: var(--muted); }}
        .tbl-wrap {{ max-height: 340px; overflow: auto; border: 1px solid var(--line); border-radius: 10px; }}
        table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; }}
        th, td {{ border-bottom: 1px solid #edf2e8; padding: 8px; text-align: left; white-space: nowrap; }}
        th {{ position: sticky; top: 0; background: #eef4e8; z-index: 1; }}
        .footer {{ margin-top: 10px; font-size: 0.82rem; color: var(--muted); }}
        @media (max-width: 980px) {{
          .top {{ grid-template-columns: 1fr 1fr; }}
          .grid {{ grid-template-columns: 1fr; }}
        }}
      </style>
    </head>
    <body>
      <div class=\"wrap\">
        <h1>RapidRelay Local-First Sync Validation</h1>
        <p>Compares local persistence and cloud state for development testing.</p>

        <div class=\"top\">
          <div class=\"card\">
            <h2>Local Environmental Rows</h2>
            <div class=\"value\">{len(local_env)}</div>
            <p>Unsynced: <span class=\"warn\">{sync_status.get('unsynced_environmental', 0)}</span></p>
          </div>
          <div class=\"card\">
            <h2>Cloud Environmental Rows</h2>
            <div class=\"value\">{len(cloud_env)}</div>
            <p>{'Supabase online' if not cloud_error else 'Supabase error'}</p>
          </div>
          <div class=\"card\">
            <h2>Local Prediction Rows</h2>
            <div class=\"value\">{len(local_preds)}</div>
            <p>Unsynced: <span class=\"warn\">{sync_status.get('unsynced_predictions', 0)}</span></p>
          </div>
          <div class=\"card\">
            <h2>Cloud Prediction Rows</h2>
            <div class=\"value\">{len(cloud_preds)}</div>
            <p>Retry queue: {sync_status.get('retry_queue_size', 0)}</p>
          </div>
        </div>

        <div class=\"grid\">
          <div class=\"card\">
            <div class=\"panel-title\"><strong>Cloud obando_environmental_data</strong><span class=\"meta\">latest 50</span></div>
            <div class=\"tbl-wrap\">
              <table>
                <thead>
                  <tr><th>ID</th><th>Device</th><th>Soil</th><th>Temp</th><th>Hum</th><th>Pressure</th><th>Distance</th><th>Date</th><th>Time</th></tr>
                </thead>
                <tbody>{env_cloud_rows or '<tr><td colspan="9">No cloud environmental rows found.</td></tr>'}</tbody>
              </table>
            </div>
          </div>

          <div class=\"card\">
            <div class=\"panel-title\"><strong>Local obando_environmental_local</strong><span class=\"meta\">latest 50</span></div>
            <div class=\"tbl-wrap\">
              <table>
                <thead>
                  <tr><th>ID</th><th>Cloud Ref</th><th>Device/Sensor</th><th>Soil</th><th>Temp</th><th>Hum</th><th>Pressure</th><th>Distance</th><th>Date</th><th>Time</th><th>Synced</th></tr>
                </thead>
                <tbody>{env_local_rows or '<tr><td colspan="11">No local environmental rows found.</td></tr>'}</tbody>
              </table>
            </div>
          </div>

          <div class=\"card\">
            <div class=\"panel-title\"><strong>Cloud flood_predictions</strong><span class=\"meta\">latest 50</span></div>
            <div class=\"tbl-wrap\">
              <table>
                <thead>
                  <tr><th>ID</th><th>Flood Probability</th><th>Risk Tier / Alert</th><th>Timestamp</th></tr>
                </thead>
                <tbody>{pred_cloud_rows or '<tr><td colspan="4">No cloud prediction rows found.</td></tr>'}</tbody>
              </table>
            </div>
          </div>

          <div class=\"card\">
            <div class=\"panel-title\"><strong>Local predictions_local</strong><span class=\"meta\">latest 50</span></div>
            <div class=\"tbl-wrap\">
              <table>
                <thead>
                  <tr><th>ID</th><th>Cloud Ref</th><th>Flood Probability</th><th>Alert</th><th>Method</th><th>Predicted At</th><th>Synced</th></tr>
                </thead>
                <tbody>{pred_local_rows or '<tr><td colspan="7">No local prediction rows found.</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div class=\"footer\">
          <div>Last local sync status: <span class=\"ok\">{_safe(sync_status.get('last_sync_status') or 'n/a')}</span></div>
          <div>Last local sync timestamp: {_safe(sync_status.get('last_sync_at') or 'n/a')}</div>
          <div>{'Cloud error: ' + _safe(cloud_error) if cloud_error else 'Cloud query succeeded.'}</div>
        </div>
      </div>
      <script>setTimeout(function(){{ location.reload(); }}, 30000);</script>
    </body>
    </html>
    """

    return HTMLResponse(content=html_content)
