# =============================================================================
# RapidRelay – FastAPI Backend
#
# Serves real-time sensor data, EO features, Himawari proxy, and alert APIs.
# Designed to be the single backend the Next.js frontend talks to.
#
# Architecture decisions:
# - FastAPI for async performance and auto-generated OpenAPI docs
# - CORS enabled for local dev (Next.js on :3000, FastAPI on :8000)
# - Mock data generators ported from Rapid-Relay-Pre-Prototype-main
# - Structured for gradual migration: mock → real sensors / SAR
# =============================================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.routers import sensors, eo, himawari, alerts


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks."""
    print("[RapidRelay] Backend starting …")
    yield
    print("[RapidRelay] Backend shutting down …")


app = FastAPI(
    title="RapidRelay Flood Monitoring API",
    version="0.1.0",
    description=(
        "Backend API for the RapidRelay flood monitoring system deployed "
        "at PAGASA – Obando, Bulacan. Provides sensor data, EO features, "
        "satellite imagery proxy, and alert management."
    ),
    lifespan=lifespan,
)

# -- CORS (allow Next.js dev server) -----------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://vercel.com",
        "*",  # tighten in production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -- Routers ------------------------------------------------------------------
app.include_router(sensors.router, prefix="/api/sensors", tags=["Sensors"])
app.include_router(eo.router, prefix="/api/eo", tags=["Earth Observation"])
app.include_router(himawari.router, prefix="/api/himawari", tags=["Himawari"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "RapidRelay Flood Monitoring API",
        "version": "0.1.0",
        "status": "running",
        "deployment": "PAGASA – Obando, Bulacan",
    }


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "healthy"}
