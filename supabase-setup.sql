-- =============================================================================
-- RapidRelay — Supabase Table Setup (updated)
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
--
-- Tables:
--   sensor_readings   — original (kept for backward compat)
--   readings_mirror   — LOCAL.DB sync target (primary cloud copy of LoRa data)
--   flood_predictions — ML prediction log
--   alerts            — alert feed
--   system_config     — cloud-editable runtime config (synced down to Pi)
-- =============================================================================

-- ─── 1. SENSOR READINGS (legacy, kept for Supabase simulator) ─────────────

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

create index if not exists idx_sr_sensor_id on public.sensor_readings (sensor_id);
create index if not exists idx_sr_timestamp on public.sensor_readings (timestamp desc);

alter table public.sensor_readings enable row level security;
create policy "Allow public read"         on public.sensor_readings for select using (true);
create policy "Allow service role insert" on public.sensor_readings for insert with check (true);


-- ─── 2. READINGS MIRROR — SQLite local.db sync target ────────────────────
-- sync_engine.py pushes readings_local rows here (synced=0 → pushed → synced=1)

create table if not exists public.readings_mirror (
  id               bigint generated always as identity primary key,
  local_id         integer not null,          -- SQLite readings_local.id
  sensor_id        text    not null,
  raw_mm           integer,
  validated_m      double precision,
  uncertainty      double precision,
  alert_level      text,
  requires_human   boolean default false,
  explanation      jsonb,
  source           text    default 'lora',    -- 'lora'|'mqtt'|'serial'|'simulate'
  local_created_at timestamptz,
  synced_at        timestamptz default now()
);

create index if not exists idx_rm_sensor on public.readings_mirror (sensor_id);
create index if not exists idx_rm_created on public.readings_mirror (local_created_at desc);
create index if not exists idx_rm_alert on public.readings_mirror (alert_level);

alter table public.readings_mirror enable row level security;
create policy "Allow public read"         on public.readings_mirror for select using (true);
create policy "Allow service role insert" on public.readings_mirror for insert with check (true);


-- ─── 3. FLOOD PREDICTIONS ────────────────────────────────────────────────

create table if not exists public.flood_predictions (
  id                bigint generated always as identity primary key,
  flood_probability double precision not null,
  alert_level       text not null,
  features_json     text,
  method            text default 'lgbm',      -- updated: lgbm / rf / xgb / rule_based
  model_version     text default 'v2',
  predicted_at      timestamptz default now()
);

create index if not exists idx_fp_predicted_at on public.flood_predictions (predicted_at desc);

alter table public.flood_predictions enable row level security;
create policy "Allow public read"         on public.flood_predictions for select using (true);
create policy "Allow service role insert" on public.flood_predictions for insert with check (true);


-- ─── 4. ALERTS ────────────────────────────────────────────────────────────

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
create index if not exists idx_alerts_level   on public.alerts (alert_level);

alter table public.alerts enable row level security;
create policy "Allow public read"         on public.alerts for select using (true);
create policy "Allow service role insert" on public.alerts for insert with check (true);
create policy "Allow service role update" on public.alerts for update using (true);


-- ─── 5. SYSTEM CONFIG — cloud-editable runtime settings ──────────────────
-- sync_engine.py pulls these down to local SQLite (source='cloud' wins)

create table if not exists public.system_config (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

alter table public.system_config enable row level security;
create policy "Allow public read"         on public.system_config for select using (true);
create policy "Allow service role insert" on public.system_config for insert with check (true);
create policy "Allow service role update" on public.system_config for update using (true);

-- Default cloud config (operators can edit these in Supabase dashboard to push to Pi)
insert into public.system_config (key, value) values
  ('alert_watch_m',                  '1.5'),
  ('alert_warning_m',                '2.0'),
  ('alert_emergency_m',              '3.0'),
  ('ensemble_uncertainty_threshold', '0.3'),
  ('hard_constraint_max_mm',         '10000'),
  ('hard_constraint_delta_mm',       '500'),
  ('ollama_model',                   'llama3.2:3b'),
  ('sync_interval_s',                '300'),
  ('lora_mode',                      'mqtt')
on conflict (key) do nothing;


-- ─── 6. ENABLE REALTIME ────────────────────────────────────────────────────

alter publication supabase_realtime add table public.sensor_readings;
alter publication supabase_realtime add table public.readings_mirror;
alter publication supabase_realtime add table public.flood_predictions;
alter publication supabase_realtime add table public.alerts;


-- ─── 7. CLEANUP FUNCTION ────────────────────────────────────────────────────

create or replace function public.cleanup_old_data()
returns void language plpgsql as $$
begin
  delete from public.readings_mirror
    where local_created_at < now() - interval '30 days';
  delete from public.sensor_readings
    where timestamp < now() - interval '7 days';
  delete from public.flood_predictions
    where predicted_at < now() - interval '30 days';
  delete from public.alerts
    where created_at < now() - interval '30 days'
    and acknowledged = true;
end;
$$;


-- ─── 8. SENSOR SIMULATOR (pg_cron — optional) ────────────────────────────

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
  base_water := 0.3 + 0.15 * sin(extract(hour from now()) * 3.14159 / 12.0)
                + (random() * 0.2 - 0.1);
  base_rain  := greatest(0, 2.0 + random() * 6.0 - 2.0);
  base_humid := 70.0 + random() * 15.0;
  base_soil  := 40.0 + random() * 20.0;
  base_temp  := 28.0 + random() * 4.0 - 2.0;

  for node in
    select * from (
      values
        ('OBD-01', 'Angat River North', 14.8369, 120.9592),
        ('OBD-02', 'San Pascual Canal',  14.8285, 120.9480),
        ('OBD-03', 'Poblacion Bridge',   14.8411, 120.9551)
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
      node.lat, node.lon,
      random() > 0.02,
      now()
    );
  end loop;
end;
$$;

-- To enable pg_cron (Supabase Dashboard > Database > Extensions > pg_cron):
-- select cron.schedule('sensor-simulator', '* * * * *', 'select public.simulate_sensor_tick()');
-- select cron.schedule('cleanup-old-data', '0 3 * * *',  'select public.cleanup_old_data()');
-- select * from cron.job;
-- select cron.unschedule('sensor-simulator');
