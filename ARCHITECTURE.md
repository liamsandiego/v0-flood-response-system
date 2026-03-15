# RAPID RELAY — Complete System Architecture
# Hyper-Localized Flood Early Warning System for Obando, Bulacan

---

## TASK 1: ARCHITECTURE AUDIT — CURRENT STATE

### Component Health Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RAPIDRELAY SYSTEM AUDIT                             │
├───────────────────────┬──────────┬──────────┬──────────┬──────────────────┤
│ Component             │ Status   │ Data     │ Persist? │ Critical Gap     │
├───────────────────────┼──────────┼──────────┼──────────┼──────────────────┤
│ FRONTEND                                                                   │
│  Auth system          │ MOCK     │ Hardcode │ localStorage │ No real auth │
│  Dashboard shell      │ WORKING  │ Mock     │ No       │ Cycles 10 events│
│  Leaflet map          │ WORKING  │ Mixed    │ No       │ 2D only         │
│  RainViewer overlay   │ WORKING  │ Real API │ Cached   │ None            │
│  Himawari overlay     │ WORKING  │ Real WMS │ No       │ None            │
│  Sentinel-1 overlay   │ MOCK     │ 3 fakes  │ No       │ Not from SAR    │
│  Sensor graphs        │ WORKING  │ Mock     │ Memory   │ No real sensors │
│  Alert engine         │ WORKING  │ Derived  │ localStorage │ Good logic  │
│  SMS broadcast        │ MOCK     │ Fake     │ No       │ No real gateway │
│  Evacuation info      │ WORKING  │ Hardcode │ N/A      │ Static content  │
│  PWA / SW             │ WORKING  │ N/A      │ CacheAPI │ Basic but works │
│  Sensor validation    │ WORKING  │ N/A      │ N/A      │ Good logic      │
│  Unit conversion      │ WORKING  │ N/A      │ localStorage │ None        │
├───────────────────────┼──────────┼──────────┼──────────┼──────────────────┤
│ BACKEND                                                                    │
│  FastAPI app shell    │ WORKING  │ N/A      │ No       │ No DB           │
│  Sensor endpoints     │ MOCK     │ Random   │ No       │ 100% random     │
│  EO/Sentinel endpoint │ MIXED    │ CSV+Mock │ CSV file │ Reads NewPhase  │
│  Himawari metadata    │ WORKING  │ Computed │ No       │ Metadata only   │
│  Alert endpoint       │ MOCK     │ Fake     │ No       │ Prints to stdout│
│  WebSocket server     │ MISSING  │ --       │ --       │ Not implemented │
│  Database layer       │ MISSING  │ --       │ --       │ Not implemented │
│  Auth middleware       │ MISSING  │ --       │ --       │ Not implemented │
│  ML model serving     │ MISSING  │ --       │ --       │ Not implemented │
│  Background scheduler │ MISSING  │ --       │ --       │ Not implemented │
├───────────────────────┼──────────┼──────────┼──────────┼──────────────────┤
│ ML PIPELINE (NewPhase)                                                     │
│  GEE sensor proxy     │ WORKING  │ Real GEE │ CSV      │ Needs GEE auth  │
│  Sentinel-1 GEE proc  │ WORKING  │ Real GEE │ CSV      │ Needs GEE auth  │
│  Feature engineering   │ WORKING  │ Derived  │ CSV      │ 13-feature set  │
│  Dataset preparation   │ WORKING  │ Merged   │ CSV      │ 173 rows only   │
│  XGBoost training     │ BROKEN   │ --       │ --       │ Feature mismatch│
│  XGBoost predictor    │ BROKEN   │ --       │ --       │ No trained model│
│  Rule-based predictor │ WORKING  │ CSV      │ CSV      │ Active fallback │
│  Console notifier     │ WORKING  │ CSV      │ Stdout   │ Console only    │
│  SMS alerting         │ EMPTY    │ --       │ --       │ 0 bytes         │
├───────────────────────┼──────────┼──────────┼──────────┼──────────────────┤
│ IOT LAYER                                                                  │
│  ChirpStack Docker    │ SKELETON │ N/A      │ Docker   │ No devices      │
│  Gateway bridge       │ MISSING  │ --       │ --       │ Not implemented │
│  Sensor firmware      │ MISSING  │ --       │ --       │ Not implemented │
│  MQTT → Pipeline      │ MISSING  │ --       │ --       │ Not implemented │
└───────────────────────┴──────────┴──────────┴──────────┴──────────────────┘
```

### Critical Findings

1. **ZERO END-TO-END DATA FLOW**: Frontend polls mock data. Backend generates
   random numbers. ML pipeline reads CSVs. IoT stack has no devices. Nothing
   is connected to anything else.

2. **ML PIPELINE IS BROKEN**: The XGBoost training script expects 14 features
   with names like `tidal_height_current` but feature_engineering.py produces
   13 features with names like `humidity_mean_24h`. Training has never run.
   No trained model exists.

3. **NO DATA PERSISTENCE**: Backend has no database. Frontend uses localStorage.
   Every API call generates fresh random data with no history or continuity.

4. **NO REAL-TIME CAPABILITY**: No WebSocket server exists. No MQTT bridge.
   No event-driven updates. Everything is HTTP request/response with
   randomly generated data.

5. **SECURITY**: CDSE OAuth2 credentials hardcoded in source. GEE project ID
   hardcoded. Default ChirpStack passwords. Backend CORS allows all origins.
   Frontend has plaintext credentials.

6. **LABEL QUALITY**: 94.8% of ML training labels are flood=1 (positive).
   The flood detection threshold (flood_extent >= 0.05) is too low,
   capturing normal background as "flood."

---

## TASK 2: SYSTEM INTEGRATION MAP — TARGET ARCHITECTURE

### End-to-End Data Flow

```
═══════════════════════════════════════════════════════════════════════════════
                         RAPID RELAY DATA FLOW
═══════════════════════════════════════════════════════════════════════════════

LAYER 1: DETECTION (Field)
─────────────────────────────

  [Ultrasonic]  [Rain Gauge]  [BME280]     [Sentinel-1 SAR]
  Water Level   Rainfall      Temp/Hum/P    Soil Sat / Flood
       │             │            │              │
       └──────┬──────┘            │         [GEE Cloud]
              │                   │              │
         [LoRa Radio AS923]      │         [sentinel1_GEE.py]
              │                   │              │
              ▼                   │              ▼
  ┌───────────────────┐          │     ┌──────────────────┐
  │  LoRaWAN Gateway  │          │     │  sentinel1_       │
  │  (RPi 5 + HAT)   │──────────┘     │  timeseries.csv   │
  │                   │                └────────┬─────────┘
  │  ChirpStack NS    │                        │
  │  MQTT Broker      │                        │
  └────────┬──────────┘                        │
           │                                    │
           ▼                                    ▼
LAYER 2: PROCESSING (Edge/Cloud)
────────────────────────────────

  ┌──────────────────────────────────────────────────────────┐
  │                    FASTAPI BACKEND                        │
  │                                                          │
  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
  │  │ MQTT Client  │  │ Sensor Store  │  │ EO Ingestor   │  │
  │  │ (ChirpStack) │─▶│ (SQLite/     │◀─│ (CSV reader)  │  │
  │  │              │  │  Supabase)   │  │               │  │
  │  └─────────────┘  └──────┬───────┘  └───────────────┘  │
  │                          │                               │
  │                          ▼                               │
  │  ┌──────────────────────────────────────────┐           │
  │  │         PREDICTION ENGINE                 │           │
  │  │                                           │           │
  │  │  ┌─────────────┐   ┌──────────────────┐ │           │
  │  │  │ Rule-Based   │   │ XGBoost Model    │ │           │
  │  │  │ (thresholds) │   │ (13 features)    │ │           │
  │  │  │ FAST: <10ms  │   │ ACCURATE: ~100ms │ │           │
  │  │  └──────┬───────┘   └────────┬─────────┘ │           │
  │  │         │    ENSEMBLE        │            │           │
  │  │         └────────┬───────────┘            │           │
  │  │                  ▼                        │           │
  │  │        [4-TIER ALERT LEVEL]               │           │
  │  │     CLEAR < WATCH < WARNING < DANGER      │           │
  │  └──────────────────┬───────────────────────┘           │
  │                     │                                    │
  │  ┌──────────────────▼───────────────────────────────┐   │
  │  │                 ALERT DISPATCHER                   │   │
  │  │  WebSocket ──▶ Dashboard (real-time)              │   │
  │  │  SMS API   ──▶ Registered residents               │   │
  │  │  MQTT      ──▶ Community speakers                 │   │
  │  │  Webhook   ──▶ Facebook DRRM page                 │   │
  │  └──────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────┘
           │
           │ WebSocket + REST API
           ▼

LAYER 3: PRESENTATION (Dashboard)
──────────────────────────────────

  ┌──────────────────────────────────────────────────────────┐
  │              NEXT.JS 14 DASHBOARD (PWA)                   │
  │                                                          │
  │  ┌──────────────────────────────────────┐               │
  │  │          MAPBOX GL JS GLOBE           │               │
  │  │  ┌────────┐ ┌────────┐ ┌──────────┐ │               │
  │  │  │Mapbox  │ │RainViewer│ │Sentinel-1│ │               │
  │  │  │3D DEM  │ │ Radar   │ │Flood Ext │ │               │
  │  │  └────────┘ └────────┘ └──────────┘ │               │
  │  │  ┌────────┐ ┌────────┐ ┌──────────┐ │               │
  │  │  │Himawari│ │Sensor  │ │Flood Risk│ │               │
  │  │  │Cloud   │ │Markers │ │Heatmap   │ │               │
  │  │  └────────┘ └────────┘ └──────────┘ │               │
  │  └──────────────────────────────────────┘               │
  │                                                          │
  │  ┌────────────┐ ┌──────────┐ ┌─────────────────────┐   │
  │  │ Glassmorphs│ │ Sensor   │ │ Time-to-Impact      │   │
  │  │ Telemetry  │ │ Graphs   │ │ Countdown           │   │
  │  │ Panels     │ │ (Recharts│ │ Barrier Deploy      │   │
  │  └────────────┘ └──────────┘ └─────────────────────┘   │
  │                                                          │
  │  ┌──────────────────────────────────────┐               │
  │  │     OFFLINE ENGINE (Service Worker)   │               │
  │  │  IndexedDB ← 24hr sensor history      │               │
  │  │  CacheAPI  ← Map tiles + app shell    │               │
  │  │  BG Sync   ← Queued alert acks        │               │
  │  └──────────────────────────────────────┘               │
  └──────────────────────────────────────────────────────────┘


OFFLINE FALLBACK PATH (Typhoon Mode):
─────────────────────────────────────

  Sensor ──LoRa──▶ RPi Gateway ──LOCAL──▶ Threshold Check
                                              │
                                   ┌──────────┴─────────┐
                                   │                     │
                              [GSM Module]         [Speaker/Siren]
                              SMS to residents     Audio alarm
                                   │
                              [MicroSD Log]
                              Store-and-forward
                              Batch sync when
                              internet restored
```

### API Contract Summary

```
FRONTEND ◄──────────────────────────► BACKEND
         │                           │
         │  WS /api/v1/ws/sensors    │  Real-time sensor stream
         │  GET /api/v1/sensors      │  Sensor metadata (GeoJSON)
         │  GET /api/v1/telemetry    │  Current readings (GeoJSON)
         │  GET /api/v1/predictions  │  ML flood predictions
         │  GET /api/v1/alerts       │  Active alert list
         │  POST /api/v1/alerts/ack  │  Acknowledge alert
         │  GET /api/v1/eo/sentinel1 │  SAR flood extent (GeoJSON)
         │  GET /api/v1/eo/history   │  EO time series
         │  GET /api/v1/impact       │  Time-to-impact estimate
         │  GET /api/v1/health       │  System health check
         │                           │
CHIRPSTACK ◄────────────────────────► BACKEND
         │  MQTT sensor/+/rx         │  Decoded LoRaWAN payloads
         │  MQTT sensor/+/status     │  Device online/offline
         │                           │
ML PIPELINE ◄──────────────────────► BACKEND
         │  Internal function call    │  feature_engineering()
         │  Internal function call    │  predict(features)
         │  File read                 │  sentinel1_timeseries.csv
```

---

## RECOMMENDED REPOSITORY STRUCTURE

```
RapidRelay/
├── ARCHITECTURE.md              ← This document
├── docker-compose.yml           ← Full stack orchestration
├── .env.example                 ← Environment variable template
│
├── frontend/                    ← Next.js 14 Dashboard (PWA)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── api/                 ← Next.js API routes (if needed)
│   ├── components/
│   │   ├── globe/               ← Mapbox GL JS 3D globe
│   │   │   ├── GlobeMap.tsx
│   │   │   ├── layers/
│   │   │   │   ├── SensorLayer.tsx
│   │   │   │   ├── RainViewerLayer.tsx
│   │   │   │   ├── HimawariLayer.tsx
│   │   │   │   ├── SentinelFloodLayer.tsx
│   │   │   │   └── FloodRiskHeatmap.tsx
│   │   │   ├── controls/
│   │   │   │   ├── TimelineControls.tsx
│   │   │   │   ├── LayerPanel.tsx
│   │   │   │   └── MapControls.tsx
│   │   │   └── overlays/
│   │   │       ├── TelemetryPanel.tsx
│   │   │       ├── AlertBanner.tsx
│   │   │       └── ImpactCountdown.tsx
│   │   ├── dashboard/
│   │   │   ├── SensorCards.tsx
│   │   │   ├── SensorGraphs.tsx
│   │   │   ├── AlertHistory.tsx
│   │   │   └── BarrierChecklist.tsx
│   │   ├── auth/
│   │   │   └── LoginScreen.tsx
│   │   └── ui/                  ← shadcn/ui primitives
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   ├── useSensorData.ts
│   │   ├── useAlerts.ts
│   │   ├── useRainViewer.ts
│   │   └── useOffline.ts
│   ├── lib/
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── alert-engine.ts
│   │   └── store.ts             ← Zustand global state
│   ├── public/
│   │   ├── sw.js
│   │   ├── manifest.json
│   │   └── sounds/
│   └── package.json
│
├── backend/                     ← FastAPI Server
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py            ← Settings from env vars
│   │   ├── database.py          ← SQLite/Supabase connection
│   │   ├── models/
│   │   │   ├── schemas.py       ← Pydantic models
│   │   │   └── database.py      ← SQLAlchemy/ORM models
│   │   ├── routers/
│   │   │   ├── sensors.py
│   │   │   ├── predictions.py
│   │   │   ├── alerts.py
│   │   │   ├── eo.py
│   │   │   └── websocket.py
│   │   ├── services/
│   │   │   ├── sensor_service.py
│   │   │   ├── prediction_service.py
│   │   │   ├── alert_service.py
│   │   │   ├── sentinel_service.py
│   │   │   └── mqtt_service.py
│   │   └── ml/
│   │       ├── feature_engine.py
│   │       ├── predictor.py
│   │       └── model/
│   │           └── flood_xgb.pkl
│   ├── requirements.txt
│   └── Dockerfile
│
├── ml-pipeline/                 ← Training & data processing
│   ├── scripts/
│   │   ├── sentinel1_GEE.py
│   │   ├── sensor_proxy_GEE.py
│   │   ├── feature_engineering.py
│   │   ├── prepare_dataset.py
│   │   └── train_model.py
│   ├── data/
│   │   ├── sensor/
│   │   ├── sentinel1/
│   │   └── datasets/
│   ├── models/
│   │   └── flood_xgb.pkl
│   └── config/
│       ├── aoi.geojson
│       └── thresholds.yaml
│
├── iot/                         ← IoT infrastructure
│   ├── chirpstack/
│   │   ├── docker-compose.yml
│   │   └── config/
│   ├── gateway/
│   │   └── mqtt_bridge.py
│   ├── simulator/
│   │   └── sensor_sim.py
│   └── firmware/
│       └── sensor_node/
│           └── main.cpp
│
└── docs/
    ├── thesis/
    ├── api-spec.md
    └── deployment.md
```

---

## SESSION RESULTS: What Was Built

### ML Pipeline Fixes
- **Fixed feature mismatch**: `train_flood_model.py` and `flood_predictor.py` expected
  14 features with wrong names. Corrected to match `feature_engineering.py`'s 13 features.
- **Fixed hardcoded paths**: `prepare_dataset.py` used absolute Windows paths. Now relative.
- **Raised flood threshold**: From 0.05 (94.8% flood!) to 0.15 (4.0% flood — realistic).
- **Trained XGBoost model**: 173 rows, 13 features, test ROC-AUC 0.94.
  Saved at `Rapid-Relay-Pre-Prototype-main/flood_preprototype/models/trained/flood_xgb_model.pkl`

### Backend Rebuild (v0.2.0)
New files created:
- `app/config.py` — Centralized settings from env vars
- `app/database.py` — SQLite + async SQLAlchemy
- `app/services/prediction_service.py` — XGBoost + rule-based fallback
- `app/services/ws_manager.py` — WebSocket connection manager
- `app/services/simulator.py` — 5-node IoT sensor simulator
- `app/routers/websocket.py` — Real-time streaming at /api/ws
- `app/routers/predictions.py` — ML prediction endpoints

### Backend API — All Tested and Working

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health + ML status |
| GET | `/api/sensors/nodes` | Sensor metadata (static GeoJSON) |
| GET | `/api/sensors/realtime` | Current telemetry (GeoJSON) |
| GET | `/api/sensors/latest` | Legacy sensor snapshot |
| GET | `/api/predictions/current` | XGBoost flood prediction |
| GET | `/api/predictions/status` | ML model metadata |
| WS | `/api/ws` | Real-time sensor + prediction stream |
| GET | `/api/eo/features` | Latest Sentinel-1 EO data |
| GET | `/api/eo/features/history` | Historical EO time series |
| POST | `/api/sensors/simulator/flood` | Trigger test flood event |
| POST | `/api/sensors/simulator/stop-flood` | Stop test flood |
| GET | `/api/himawari/*` | Satellite imagery metadata |
| POST | `/api/alerts/trigger` | Alert dispatch |

---

## FRONTEND 3D GLOBE ARCHITECTURE (Next Phase)

### Mapbox GL JS Migration Plan

Replace OptimizedLeafletMap.tsx with Mapbox GL JS for:
- `projection: "globe"` — 3D globe rendering
- Built-in terrain with Mapbox DEM
- setFeatureState() for 100+ sensor nodes at 60 FPS
- Proper GeoJSON source/layer pipeline

### Key Dependencies
```
pnpm add mapbox-gl @types/mapbox-gl zustand
# OR for free alternative:
pnpm add maplibre-gl
```

### Component Architecture
```
components/globe/
  GlobeMap.tsx          — Main Mapbox GL component (full-screen)
  useMapbox.ts          — Hook: map instance lifecycle
  layers/
    SensorLayer.tsx     — Feature-state driven sensor markers
    RainViewerLayer.tsx — Animated radar tiles
    HimawariLayer.tsx   — WMS satellite overlay
    SentinelLayer.tsx   — SAR flood extent polygons
    TerrainLayer.tsx    — 3D DEM elevation
  controls/
    TimelineBar.tsx     — Bottom scrubber (like Zoom Earth)
    LayerPanel.tsx      — Floating glassmorphism panel
    TelemetryPanel.tsx  — Sensor readings + graphs
    AlertBanner.tsx     — Critical mode full-width banner
    ImpactCountdown.tsx — Time-to-flood estimation
```

### WebSocket Integration Hook
```typescript
// hooks/useWebSocket.ts
// Connects to ws://localhost:8000/api/ws
// Receives: { type: "sensor_update", data: GeoJSON, prediction: {...} }
// Updates Zustand store -> triggers map.setFeatureState() per sensor
// Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
```

---

## DEPLOYMENT ROADMAP

### Phase 1: Foundation (Week 1-2) — PARTIALLY COMPLETE
- [x] Architecture audit
- [x] Fix ML pipeline feature mismatch
- [x] Train XGBoost model
- [x] Rebuild backend with WebSocket + ML + Simulator
- [ ] Replace Leaflet with Mapbox GL JS globe
- [ ] Connect frontend WebSocket to backend
- [ ] Implement Zustand state management

### Phase 2: Integration (Week 3-4)
- [ ] Wire RainViewer animation to timeline controls
- [ ] Add Sentinel-1 flood extent polygons from real CSV
- [ ] Implement time-to-impact calculation
- [ ] Add mechanical barrier deployment checklist
- [ ] PWA offline mode with IndexedDB (Dexie.js)

### Phase 3: Edge Computing (Week 5-6)
- [ ] Deploy ChirpStack on Raspberry Pi 5
- [ ] MQTT bridge: ChirpStack -> FastAPI
- [ ] Offline threshold alerting on gateway
- [ ] Store-and-forward queue for internet outages
- [ ] GSM/SMS fallback via serial AT commands

### Phase 4: Polish & Defense (Week 7-8)
- [ ] Alert system: SMS broadcast via GSM module
- [ ] Community speaker integration (audio alerts)
- [ ] End-to-end testing with simulated typhoon scenario
- [ ] Performance optimization (target: 60 FPS, <1s latency)
- [ ] Documentation and thesis defense preparation

### Quick Start
```bash
# Terminal 1: Backend (sensor simulator starts automatically)
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Frontend
cd v0-flood-response-system
pnpm install
pnpm dev

# Open http://localhost:3000 for dashboard
# Open http://localhost:8000/docs for Swagger API docs
# WebSocket at ws://localhost:8000/api/ws
```
