-- =============================================================================
-- RapidRelay — Public Read Access for Unauthenticated Clients
--
-- Allows ANON role (frontend with NEXT_PUBLIC_SUPABASE_ANON_KEY) to read
-- sensor data needed for the UI.
--
-- Run this migration in Supabase SQL editor AFTER 01_rls_policies.sql and 02_sensor_status_rls.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Grant SELECT to anon role on sensor tables
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON sensor_readings TO anon;
GRANT SELECT ON sensor_status TO anon;
GRANT SELECT ON obando_environmental_data TO anon;
GRANT SELECT ON flood_predictions TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Create public read policy for obando_environmental_data
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE obando_environmental_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read obando environmental data"
  ON obando_environmental_data FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Create public read policy for flood_predictions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE flood_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read flood predictions"
  ON flood_predictions FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Update sensor_readings policy to include anon
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view sensor readings" ON sensor_readings;

CREATE POLICY "Public read sensor readings"
  ON sensor_readings FOR SELECT
  USING (true);
