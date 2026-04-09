-- =============================================================================
-- RapidRelay — Enable Realtime for obando_environmental_data
--
-- Run this in Supabase SQL Editor to fix the realtime subscription error.
-- =============================================================================

-- Enable RLS on obando_environmental_data (if not already enabled)
ALTER TABLE obando_environmental_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Public can view environmental data" ON obando_environmental_data;
DROP POLICY IF EXISTS "Authenticated users can insert data" ON obando_environmental_data;

-- Policy: Allow public/anon to READ environmental data
-- This is needed for Supabase Realtime to work with anon key
CREATE POLICY "Public can view environmental data"
  ON obando_environmental_data FOR SELECT
  USING (true);  -- Public read access (sensor data is public)

-- Policy: Allow authenticated users to INSERT (optional, for app writes)
CREATE POLICY "Authenticated users can insert data"
  ON obando_environmental_data FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Grant SELECT to anon and authenticated roles
GRANT SELECT ON obando_environmental_data TO anon, authenticated;

-- =============================================================================
-- IMPORTANT: After running this SQL, you MUST enable Realtime in Supabase UI:
-- 
-- 1. Go to: Supabase Dashboard → Database → Replication
-- 2. Find table: obando_environmental_data
-- 3. Enable the toggle for "Realtime"
-- 4. Redeploy your Vercel app
-- =============================================================================

-- Verify policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'obando_environmental_data';

-- =============================================================================
-- Performance indexes for dashboard queries
-- Run once to keep Data and History tab queries fast as rows grow.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_obando_environmental_data_id_desc
  ON public.obando_environmental_data (id DESC);

CREATE INDEX IF NOT EXISTS idx_flood_predictions_created_at_desc
  ON public.flood_predictions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flood_predictions_timestamp_desc
  ON public.flood_predictions ("timestamp" DESC);
