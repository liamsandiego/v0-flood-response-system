# RapidRelay — Development Setup Guide

## Prerequisites

- **Node.js** 18+ and **pnpm** (for the Next.js frontend)
- **Python** 3.10+ (for the FastAPI backend)
- **VS Code** (recommended — use the multi-root workspace file)

---

## Quick Start

### 1. Open the workspace

```
File → Open Workspace from File → rapidrelay.code-workspace
```

### 2. Frontend (Next.js)

```bash
cd v0-flood-response-system
pnpm install
pnpm dev          # → http://localhost:3000
```

### 3. Backend (FastAPI)

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000   # → http://localhost:8000
```

### 4. Environment Variables

```bash
# From the workspace root:
cp .env.example .env
# Edit .env if necessary (defaults work for local dev)
```

---

## Architecture Overview

```
RapidRelay/
├── v0-flood-response-system/     # Next.js 14 frontend
│   ├── components/
│   │   ├── map/
│   │   │   ├── LeafletMap.tsx    # Smooth Leaflet with Himawari overlay
│   │   │   └── MapControls.tsx   # Layer toggles, opacity, time picker
│   │   ├── dashboard.tsx         # Main dashboard (imports map components)
│   │   └── ...
│   ├── hooks/
│   │   └── use-map-layers.ts     # Map layer state management
│   └── lib/
│       └── map-types.ts          # TypeScript types for map layers
│
├── backend/                       # FastAPI backend
│   ├── app/
│   │   ├── main.py               # FastAPI app + CORS + routers
│   │   ├── routers/
│   │   │   ├── sensors.py        # GET /api/sensors/latest
│   │   │   ├── eo.py             # GET /api/eo/features
│   │   │   ├── himawari.py       # GET /api/himawari/capabilities
│   │   │   └── alerts.py         # POST /api/alerts/trigger
│   │   ├── services/
│   │   │   ├── sensor_service.py     # Mock → real sensor generation
│   │   │   ├── sentinel_service.py   # EO features + STAC catalog
│   │   │   └── himawari_service.py   # NASA GIBS metadata
│   │   └── models/
│   │       └── schemas.py        # Pydantic models
│   └── requirements.txt
│
├── Rapid-Relay-Pre-Prototype-main/   # Original Python prototype
│
├── .env.example                  # Environment variable template
└── rapidrelay.code-workspace     # VS Code multi-root workspace
```

---

## API Endpoints

| Method | Endpoint                     | Description                              |
| ------ | ---------------------------- | ---------------------------------------- |
| GET    | `/api/sensors/latest`        | Latest sensor snapshot (mock)            |
| GET    | `/api/sensors/history?limit` | N recent snapshots                       |
| GET    | `/api/eo/features`           | Latest EO features                       |
| GET    | `/api/eo/features/history`   | EO feature time series                   |
| GET    | `/api/eo/sentinel/catalog`   | Local Sentinel-1 metadata files          |
| GET    | `/api/eo/sentinel/search`    | Search STAC for recent Sentinel-1        |
| GET    | `/api/himawari/capabilities` | Himawari product info (GIBS params)      |
| GET    | `/api/himawari/times`        | Available GIBS date strings              |
| GET    | `/api/himawari/best-time`    | Best available date for Himawari         |
| POST   | `/api/alerts/trigger`        | Manual alert broadcast                   |
| GET    | `/health`                    | Health check                             |

---

## Map Features

### Smooth Leaflet (Windy-like)

The `LeafletMap` component uses:

- **Fractional zoom** (`zoomSnap: 0.1`) — no more integer-level jumps
- **Smooth wheel zoom** — custom `requestAnimationFrame` handler with lerp easing
- **Inertia panning** — momentum after drag release
- **Canvas renderer** — hardware-accelerated drawing
- **CSS tile transitions** — crossfade between zoom levels

### Himawari Satellite Overlay (NASA GIBS)

- **Free** — no API key, no registration
- **Direct WMS** — the browser fetches tiles from `gibs.earthdata.nasa.gov`
- **Two products**: Clean Infrared (day+night) and Red Visible (day only)
- **Time dimension**: Date picker + quick offset buttons (−4h, −12h, −24h)
- **Opacity slider**: 0–100%
- **Max zoom**: Level 8 (GIBS limitation for Himawari)

### Base Maps

Choose from: Esri Satellite, Esri Dark Gray, CartoDB Dark, OpenStreetMap

---

## Phase 2 Roadmap

1. **Real sensor integration** — Replace mock generation with LoRaWAN/MQTT polling
2. **Sentinel-1 SAR processing** — Download GRD data, process with SNAP/rasterio, generate flood extent GeoTIFFs
3. **RainViewer radar overlay** — Real-time precipitation radar integration
4. **Database** — PostgreSQL + TimescaleDB for sensor time series
5. **SMS alerts** — Twilio integration for real broadcasts
6. **Docker** — `docker-compose.yml` for unified deployment
