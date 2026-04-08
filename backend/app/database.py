# =============================================================================
# RapidRelay – Database Layer (SQLite + aiosqlite for async)
#
# Uses SQLAlchemy 2.0 async pattern with SQLite for zero-config deployment.
# Stores: sensor readings, predictions, alerts, events.
# =============================================================================

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import (
    Column, Integer, Float, String, Boolean, DateTime, Text,
    create_engine, event,
)
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import DATABASE_URL


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SensorReadingDB(Base):
    __tablename__ = "sensor_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sensor_id = Column(String(64), nullable=False, index=True)
    water_level = Column(Float, nullable=True)
    rainfall = Column(Float, nullable=True)
    humidity = Column(Float, nullable=True)
    soil_moisture = Column(Float, nullable=True)
    temperature = Column(Float, nullable=True)
    pressure = Column(Float, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    is_valid = Column(Boolean, default=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    received_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FloodPredictionDB(Base):
    __tablename__ = "flood_predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    flood_probability = Column(Float, nullable=False)
    alert_level = Column(String(16), nullable=False)
    features_json = Column(Text, nullable=True)
    model_version = Column(String(32), default="v1")
    predicted_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AlertDB(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_level = Column(String(16), nullable=False)
    message = Column(Text, nullable=False)
    source = Column(String(32), default="system")
    channels_sent = Column(Text, nullable=True)  # JSON list
    acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)


class ReadingsLocalDB(Base):
    """
    Local-first readings table — primary data store for LoRa sensor pipeline.
    Mirrors schema.sql readings_local; synced up to Supabase by sync_engine.py.
    """
    __tablename__ = "readings_local"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sensor_id = Column(String(64), nullable=False, index=True)
    raw_mm = Column(Integer, nullable=True)          # raw LoRa value (mm)
    validated_m = Column(Float, nullable=True)        # converted meters
    uncertainty = Column(Float, nullable=True)        # ensemble variance
    alert_level = Column(String(16), default="NORMAL")
    requires_human = Column(Boolean, default=False)   # high uncertainty flag
    explanation = Column(Text, nullable=True)         # Woody JSON output
    constraint_pass = Column(Boolean, default=True)  # passed hard constraints
    constraint_note = Column(Text, nullable=True)    # drop/flag reason
    synced = Column(Boolean, default=False)           # pushed to Supabase
    cloud_id = Column(String(64), nullable=True)      # Supabase UUID
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)



# ---------------------------------------------------------------------------
# Engine + Session Factory
# ---------------------------------------------------------------------------

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Create all tables if they don't exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[DB] Tables initialized")


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
