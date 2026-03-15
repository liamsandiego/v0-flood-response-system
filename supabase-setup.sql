-- =============================================================================
-- RapidRelay – Supabase Table Setup
--
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Creates: sensor_readings, flood_predictions, alerts
-- Enables: Realtime on sensor_readings for live frontend subscriptions
-- Includes: Cron-based simulator for deployment (no backend needed)
-- =============================================================================

-- ─── 1. SENSOR READINGS ─────────────────────────────────────────────────────

create table if not exists public.sensor_readings (
  id            bigint generated always as identity primary key,
  sensor_id     text not null,
  water_level   double precision,
  rainfall      double precision,
  humidity      double precision,
  soil_moisture double precision,
  temperature   double precision,
  pressure      double precision,
  latitude      double precision,
  longitude     double precision,
  is_valid      boolean default true,
  timestamp     timestamptz not null default now(),
  received_at   timestamptz default now()
);

-- Indexes for fast queries
create index if not exists idx_sr_sensor_id on public.sensor_readings (sensor_id);
create index if not exists idx_sr_timestamp on public.sensor_readings (timestamp desc);
create index if not exists idx_sr_sensor_ts on public.sensor_readings (sensor_id, timestamp desc);

-- RLS: allow anon reads, service role writes
alter table public.sensor_readings enable row level security;

create policy "Allow public read" on public.sensor_readings
  for select using (true);

create policy "Allow service role insert" on public.sensor_readings
  for insert with check (true);


-- ─── 2. FLOOD PREDICTIONS ───────────────────────────────────────────────────

create table if not exists public.flood_predictions (
  id                bigint generated always as identity primary key,
  flood_probability double precision not null,
  alert_level       text not null,
  features_json     text,
  method            text default 'unknown',
  model_version     text default 'v1',
  predicted_at      timestamptz default now()
);

create index if not exists idx_fp_predicted_at on public.flood_predictions (predicted_at desc);

alter table public.flood_predictions enable row level security;

create policy "Allow public read" on public.flood_predictions
  for select using (true);

create policy "Allow service role insert" on public.flood_predictions
  for insert with check (true);


-- ─── 3. ALERTS ──────────────────────────────────────────────────────────────

create table if not exists public.alerts (
  id              bigint generated always as identity primary key,
  alert_level     text not null,
  title           text,
  message         text not null,
  source          text default 'system',
  channels_sent   text,
  acknowledged    boolean default false,
  acknowledged_by text,
  created_at      timestamptz default now(),
  acknowledged_at timestamptz
);

create index if not exists idx_alerts_created on public.alerts (created_at desc);

alter table public.alerts enable row level security;

create policy "Allow public read" on public.alerts
  for select using (true);

create policy "Allow service role insert" on public.alerts
  for insert with check (true);


-- ─── 4. ENABLE REALTIME ─────────────────────────────────────────────────────
-- This lets the frontend subscribe to new rows via Supabase Realtime

alter publication supabase_realtime add table public.sensor_readings;
alter publication supabase_realtime add table public.flood_predictions;
alter publication supabase_realtime add table public.alerts;


-- ─── 5. CLEANUP FUNCTION (keeps DB under free-tier limits) ──────────────────
-- Deletes sensor readings older than 7 days, predictions older than 30 days

create or replace function public.cleanup_old_data()
returns void language plpgsql as $$
begin
  delete from public.sensor_readings
    where timestamp < now() - interval '7 days';
  delete from public.flood_predictions
    where predicted_at < now() - interval '30 days';
  delete from public.alerts
    where created_at < now() - interval '30 days';
end;
$$;


-- ─── 6. SENSOR SIMULATOR (for deployment without backend) ───────────────────
-- Generates realistic sensor readings matching the 5 Obando nodes.
-- Enable the pg_cron extension first (Supabase Dashboard > Database > Extensions)

create or replace function public.simulate_sensor_tick()
returns void language plpgsql as $$
declare
  base_water  double precision;
  base_rain   double precision;
  base_humid  double precision;
  base_soil   double precision;
  base_temp   double precision;
  node        record;
begin
  -- Base values with time-of-day variation (higher water at night/dawn)
  base_water := 0.3 + 0.15 * sin(extract(hour from now()) * 3.14159 / 12.0)
                + (random() * 0.2 - 0.1);
  base_rain  := greatest(0, 2.0 + random() * 6.0 - 2.0);
  base_humid := 70.0 + random() * 15.0;
  base_soil  := 40.0 + random() * 20.0;
  base_temp  := 28.0 + random() * 4.0 - 2.0;

  -- 5 Obando sensor nodes
  for node in
    select * from (
      values
        ('obando-brgy-01', 'Brgy. Binuangan',  14.7094, 120.9358),
        ('obando-brgy-02', 'Brgy. Catanghalan', 14.7120, 120.9310),
        ('obando-brgy-03', 'Brgy. Paco',        14.7060, 120.9400),
        ('obando-brgy-04', 'Brgy. Salambao',    14.7140, 120.9280),
        ('obando-brgy-05', 'Brgy. PAGASA Stn',  14.7072, 120.9376)
    ) as t(id, name, lat, lon)
  loop
    insert into public.sensor_readings (
      sensor_id, water_level, rainfall, humidity, soil_moisture,
      temperature, latitude, longitude, is_valid, timestamp
    ) values (
      node.id,
      base_water + (random() * 0.1 - 0.05),
      base_rain  + (random() * 2.0 - 1.0),
      base_humid + (random() * 5.0 - 2.5),
      base_soil  + (random() * 8.0 - 4.0),
      base_temp  + (random() * 1.0 - 0.5),
      node.lat,
      node.lon,
      random() > 0.02,  -- 98% valid
      now()
    );
  end loop;
end;
$$;

-- ─── 7. SCHEDULE CRON JOBS ──────────────────────────────────────────────────
-- Enable pg_cron extension first: Supabase Dashboard > Database > Extensions
-- Then uncomment and run these:

-- Simulate sensor readings every minute (inserts 5 nodes per call)
-- pg_cron minimum interval is 1 minute — use '* * * * *' not seconds
-- select cron.schedule('sensor-simulator', '* * * * *', 'select public.simulate_sensor_tick()');

-- Cleanup old data daily at 3am UTC
-- select cron.schedule('cleanup-old-data', '0 3 * * *', 'select public.cleanup_old_data()');

-- To check scheduled jobs:  select * from cron.job;
-- To stop simulator:        select cron.unschedule('sensor-simulator');
