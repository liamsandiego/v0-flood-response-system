-- =============================================================================
-- RapidRelay — Sensor Status & Data Linking (RLS Extensions)
--
-- Links sensor_readings to sensor_status for real-time monitoring.
-- Enables RLS on sensor_status table and creates policies for secure access.
-- Run this migration in Supabase SQL editor AFTER 01_rls_policies.sql.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Create sensor_status table (cache of latest readings per sensor)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sensor_status (
  id BIGSERIAL PRIMARY KEY,
  sensor_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  latitude DECIMAL(10, 6) NOT NULL,
  longitude DECIMAL(10, 6) NOT NULL,

  -- Latest readings
  water_level DECIMAL(5, 2),
  rainfall DECIMAL(5, 1),
  humidity DECIMAL(5, 1),
  soil_moisture DECIMAL(5, 1),
  temperature DECIMAL(5, 1),

  -- Status flags
  is_valid BOOLEAN DEFAULT true,
  overall_status TEXT DEFAULT 'normal' CHECK (overall_status IN ('normal', 'warning', 'critical')),

  -- Timestamps
  last_reading_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on sensor_status
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sensor_status ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to READ sensor status
CREATE POLICY "Users can view sensor status"
  ON sensor_status FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Policy: Allow service role to INSERT sensor status
CREATE POLICY "Service role can insert sensor status"
  ON sensor_status FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Allow service role to UPDATE sensor status
CREATE POLICY "Service role can update sensor status"
  ON sensor_status FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant permissions to roles
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON sensor_status TO authenticated;
GRANT SELECT, INSERT, UPDATE ON sensor_status TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Create indexes for performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sensor_status_updated_at ON sensor_status(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_status_overall_status ON sensor_status(overall_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: Auto-update sensor_status from sensor_readings on INSERT
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_sensor_status_from_reading()
RETURNS TRIGGER AS $$
BEGIN
  -- Determine overall status based on thresholds
  DECLARE
    overall_status TEXT := 'normal';
  BEGIN
    -- Water level thresholds
    IF NEW.water_level >= 2.5 THEN
      overall_status := 'critical';
    ELSIF NEW.water_level >= 1.5 THEN
      overall_status := 'warning';
    END IF;

    -- Soil moisture thresholds
    IF NEW.soil_moisture >= 80 THEN
      overall_status := 'critical';
    ELSIF NEW.soil_moisture >= 60 AND overall_status != 'critical' THEN
      overall_status := 'warning';
    END IF;

    -- Humidity thresholds
    IF NEW.humidity >= 90 THEN
      overall_status := 'critical';
    ELSIF NEW.humidity >= 75 AND overall_status != 'critical' THEN
      overall_status := 'warning';
    END IF;

    -- Insert or update sensor_status
    INSERT INTO sensor_status (
      sensor_id, name, latitude, longitude,
      water_level, rainfall, humidity, soil_moisture, temperature,
      is_valid, overall_status, last_reading_at, updated_at
    ) VALUES (
      NEW.sensor_id, NEW.sensor_id, NEW.latitude, NEW.longitude,
      NEW.water_level, NEW.rainfall, NEW.humidity, NEW.soil_moisture, NEW.temperature,
      NEW.is_valid, overall_status, NEW.timestamp, now()
    )
    ON CONFLICT (sensor_id)
    DO UPDATE SET
      water_level = NEW.water_level,
      rainfall = NEW.rainfall,
      humidity = NEW.humidity,
      soil_moisture = NEW.soil_moisture,
      temperature = NEW.temperature,
      is_valid = NEW.is_valid,
      overall_status = overall_status,
      last_reading_at = NEW.timestamp,
      updated_at = now();

    RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_sensor_status ON sensor_readings;

-- Create trigger
CREATE TRIGGER trigger_update_sensor_status
AFTER INSERT ON sensor_readings
FOR EACH ROW
EXECUTE FUNCTION update_sensor_status_from_reading();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill sensor_status from existing sensor_readings
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO sensor_status (sensor_id, name, latitude, longitude, water_level, rainfall, humidity, soil_moisture, temperature, is_valid, last_reading_at)
SELECT DISTINCT ON (sr.sensor_id)
  sr.sensor_id,
  sr.sensor_id,
  sr.latitude,
  sr.longitude,
  sr.water_level,
  sr.rainfall,
  sr.humidity,
  sr.soil_moisture,
  sr.temperature,
  sr.is_valid,
  sr.timestamp
FROM sensor_readings sr
ORDER BY sr.sensor_id, sr.timestamp DESC
ON CONFLICT (sensor_id) DO NOTHING;
