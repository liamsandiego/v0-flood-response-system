-- =============================================================================
-- RapidRelay — Row Level Security (RLS) Policies
--
-- Enable RLS on sensor_data and sensor_readings tables to secure data access.
-- Run this migration in Supabase SQL editor.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on sensor_data table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sensor_data ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to READ their own sensor data
CREATE POLICY "Users can view their own sensor data"
  ON sensor_data FOR SELECT
  USING (auth.uid()::text = user_id OR auth.role() = 'authenticated');

-- Policy: Allow service role (backend) to INSERT sensor data
CREATE POLICY "Service role can insert sensor data"
  ON sensor_data FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Allow service role to UPDATE sensor data
CREATE POLICY "Service role can update sensor data"
  ON sensor_data FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on sensor_readings table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to READ sensor readings
CREATE POLICY "Users can view sensor readings"
  ON sensor_readings FOR SELECT
  USING (true);  -- Public read (all authenticated users)

-- Policy: Allow service role to INSERT sensor readings
CREATE POLICY "Service role can insert sensor readings"
  ON sensor_readings FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Allow service role to UPDATE sensor readings
CREATE POLICY "Service role can update sensor readings"
  ON sensor_readings FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant permissions to anon and authenticated roles
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON sensor_data TO authenticated;
GRANT SELECT ON sensor_readings TO authenticated;

-- Service role (FastAPI backend) gets full access — no RLS restrictions
GRANT SELECT, INSERT, UPDATE, DELETE ON sensor_data TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sensor_readings TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes for performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sensor_data_user_id ON sensor_data(user_id);
CREATE INDEX IF NOT EXISTS idx_sensor_data_created_at ON sensor_data(created_at);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_timestamp ON sensor_readings(timestamp);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor_id ON sensor_readings(sensor_id);
