# RAPID RELAY — Hyper-Localized Flood Early Warning System

> Thesis project for Obando, Bulacan, Philippines. Real-time flood monitoring
> with IoT sensors, XGBoost ML predictions, Groq AI interpretation, satellite
> imagery (Himawari-9 + Sentinel-1), and a 3D Mapbox globe dashboard.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 18+ | https://nodejs.org |
| **Python** | 3.12+ | https://www.python.org |
| **Git** | any | https://git-scm.com |

You also need API keys (see [Environment Variables](#environment-variables) below).

---

## Quick Start (Windows)

### One-click

1. Double-click **`start.bat`** — starts backend + frontend in separate windows
2. Open http://localhost:3000
3. To stop: double-click **`kill.bat`**

### First-time setup

```powershell
# 1. Install backend Python dependencies
cd D:\Downloads\Downloads\RapidRelay\backend
pip install -r requirements.txt

# 2. Install frontend Node dependencies
cd D:\Downloads\Downloads\RapidRelay\v0-flood-response-system
npm install

# 3. Set up your .env files (see Environment Variables below)

# 4. Run start.bat or follow manual steps below
```

### Manual start (two terminals)

```powershell
# Terminal 1 — Backend (FastAPI on port 8001)
cd D:\Downloads\Downloads\RapidRelay\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# Terminal 2 — Frontend (Next.js on port 3000)
cd D:\Downloads\Downloads\RapidRelay\v0-flood-response-system
npm run dev
```

> **Important**: Always use `python -m uvicorn`, NOT bare `uvicorn`.

---

## URLs

| Service | URL |
|---------|-----|
| Frontend (Dashboard) | http://localhost:3000 |
| Backend API | http://localhost:8001 |
| Swagger API Docs | http://localhost:8001/docs |
| WebSocket | ws://localhost:8001/api/ws |
| AI Interpretation | http://localhost:8001/api/ai/interpret |
| ML Prediction | http://localhost:8001/api/predictions/current |
| Sentinel-1 Dates | http://localhost:8001/api/eo/sentinel/flood-extents |

---

## Environment Variables

### Frontend — `v0-flood-response-system/.env.local`

```env
NEXT_PUBLIC_MAPBOX_TOKEN=<your-mapbox-token>
NEXT_PUBLIC_WS_URL=ws://localhost:8001/api/ws
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

Get a free Mapbox token at https://account.mapbox.com/access-tokens/

### Backend — `backend/.env`

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
GROQ_API_KEY=<your-groq-api-key>
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

Get a free Groq key at https://console.groq.com/keys

> **Never commit `.env` files.** Both are in `.gitignore`.

---

## Project Structure

```
RapidRelay/
├── start.bat                    # One-click start (Windows)
├── kill.bat                     # One-click stop (Windows)
├── README.md                    # This file
│
├── backend/                     # FastAPI backend (Python)
│   ├── .env                     # Supabase + Groq keys
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py              # Entry point, sensor loop, routers
│   │   ├── config.py            # Env vars, paths, thresholds
│   │   ├── routers/
│   │   │   ├── ai.py            # GET /api/ai/interpret
│   │   │   ├── predictions.py   # GET /api/predictions/*
│   │   │   ├── sensors.py       # GET /api/sensors/*
│   │   │   ├── eo.py            # GET /api/eo/sentinel/*
│   │   │   ├── alerts.py        # GET/POST /api/alerts
│   │   │   └── websocket.py     # WS /api/ws
│   │   └── services/
│   │       ├── ai_service.py    # Groq LLM interpretation
│   │       ├── prediction_service.py  # XGBoost ML
│   │       ├── simulator.py     # 5-node IoT simulator
│   │       └── ws_manager.py    # WebSocket manager
│   └── rapidrelay.db            # SQLite (auto-created)
│
├── v0-flood-response-system/    # Next.js 15 frontend
│   ├── .env.local               # Mapbox + Supabase keys
│   ├── components/
│   │   ├── app-shell.tsx        # Main dashboard layout
│   │   ├── globe/GlobeMap.tsx   # 3D Mapbox globe
│   │   ├── panels/             # AI, Prediction, Telemetry panels
│   │   └── map/                # Layer controls, animation
│   ├── hooks/
│   │   ├── use-himawari.ts     # Satellite animation (Zoom Earth)
│   │   ├── use-rainviewer.ts   # Radar overlay
│   │   └── useWebSocket.ts     # Backend WebSocket
│   ├── stores/sensorStore.ts   # Zustand state
│   └── lib/                    # Utilities, types
│
└── Rapid-Relay-Pre-Prototype-main/  # ML pipeline
    └── flood_preprototype/
        ├── models/trained/      # XGBoost model (.pkl)
        ├── data/                # GEE + sensor CSVs
        └── scripts/             # Training scripts
```

---

## Architecture

```
                         ┌─────────────────────────┐
                         │       Supabase           │
                         │  (Postgres + Auth)       │
                         │                          │
                         │  - sensor_readings       │
                         │  - flood_predictions     │
                         │  - alerts / profiles     │
                         └─────┬──────────┬─────────┘
                          write │          │ read+auth
                               ▼          ▼
┌──────────────────────┐    ┌─────────────────────────┐
│  Backend :8001       │◄──►│  Frontend :3000         │
│  FastAPI             │ WS │  Next.js 15             │
│                      │────►│                         │
│  - IoT Simulator     │    │  - 3D Mapbox Globe      │
│  - XGBoost ML        │    │  - Himawari-9 Satellite │
│  - Groq AI           │    │  - RainViewer Radar     │
│  - Sentinel-1 GEE    │    │  - Sensor Dashboard     │
└──────┬───────────────┘    │  - AI Analysis Panel    │
       │                    └─────────────────────────┘
       ▼
  ┌──────────┐   ┌────────────┐
  │ Groq AI  │   │ NASA GIBS  │
  │ (LLM)    │   │ (Tiles)    │
  └──────────┘   └────────────┘
```

**Data loop (every 5 seconds):**
1. Simulator → 5 sensor readings → Supabase + WebSocket
2. Every 60s: XGBoost ML → flood prediction → Supabase + WebSocket
3. Frontend Zustand store → dashboard UI (cards, graphs, alerts)
4. Every 60s: AI panel → `/api/ai/interpret` → Groq reads sensors + ML → returns analysis

---

## Satellite Layers

| Layer | Source | Frames | Update |
|-------|--------|--------|--------|
| Himawari-9 IR | NASA GIBS `all` | 24 hourly | 3-5h delay |
| Himawari-9 Visible | NASA GIBS `all` | 24 hourly | Daytime only |
| RainViewer Radar | RainViewer API | ~12 frames | Real-time |
| Sentinel-1 SAR | GEE → Backend | 175 dates | 2017-2026 |

Himawari uses **Zoom Earth pattern**: all 24 sources pre-mounted, only opacity toggles.

---

## Troubleshooting

### EPERM `.next\trace` (Windows)
```powershell
kill.bat          # Kill all processes
start.bat         # Restart clean
```
Permanent fix: Exclude `.next` from Windows Defender.

### Port already in use
```powershell
netstat -ano | findstr ":8001"
taskkill /F /PID <PID>
# Or just: kill.bat
```

### "No module named 'groq'"
```powershell
cd backend
pip install -r requirements.txt
```

### "No module named 'app'"
Wrong directory. Must be inside `backend/`:
```powershell
cd backend
python -m uvicorn app.main:app --port 8001 --reload
```

### AI panel: "Failed to connect"
1. Backend running? → http://localhost:8001
2. `GROQ_API_KEY` set in `backend/.env`?
3. Test: http://localhost:8001/api/ai/interpret

### Blank page / MODULE_NOT_FOUND
```powershell
cd v0-flood-response-system
rmdir /s /q .next
npm install
npm run dev
```

---

## Login

Auth uses Supabase. Users must exist in Supabase Auth with emails like `admin@rapidrelay.local`. Contact your administrator for credentials.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind v4, Mapbox GL JS v3 |
| State | Zustand |
| Backend | FastAPI, Python 3.12, async SQLite |
| ML | XGBoost (173 rows, 13 features, ROC-AUC 0.94) |
| AI | Groq — Llama 4 Scout 17B |
| Database | Supabase (Postgres + Auth) |
| IoT | ChirpStack LoRaWAN (AS923 PH) |
| Satellite | NASA GIBS, RainViewer, Google Earth Engine |
| PWA | Service Worker, offline cache v2 |
