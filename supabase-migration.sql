-- =============================================================================
-- RapidRelay — Supabase MIGRATION (run this, not supabase-setup.sql)
-- Only adds NEW tables/policies that don't exist yet.
-- Safe to re-run — uses IF NOT EXISTS + exception handling.
-- =============================================================================


-- ─── 1. READINGS MIRROR (new) ────────────────────────────────────────────────

create table if not exists public.readings_mirror (
  id               bigint generated always as identity primary key,
  local_id         integer not null,
  sensor_id        text    not null,
  raw_mm           integer,
  validated_m      double precision,
  uncertainty      double precision,
  alert_level      text,
  requires_human   boolean default false,
  explanation      jsonb,
  source           text    default 'lora',
  local_created_at timestamptz,
  synced_at        timestamptz default now()
);

create index if not exists idx_rm_sensor  on public.readings_mirror (sensor_id);
create index if not exists idx_rm_created on public.readings_mirror (local_created_at desc);
create index if not exists idx_rm_alert   on public.readings_mirror (alert_level);

alter table public.readings_mirror enable row level security;

do $$ begin
  create policy "Allow public read"         on public.readings_mirror for select using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Allow service role insert" on public.readings_mirror for insert with check (true);
exception when duplicate_object then null;
end $$;


-- ─── 2. SYSTEM CONFIG (new) ────────────────────────────────────────────────

create table if not exists public.system_config (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

alter table public.system_config enable row level security;

do $$ begin
  create policy "Allow public read"         on public.system_config for select using (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Allow service role insert" on public.system_config for insert with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "Allow service role update" on public.system_config for update using (true);
exception when duplicate_object then null;
end $$;

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


-- ─── 3. ADD title COLUMN TO alerts (if missing) ───────────────────────────

do $$ begin
  alter table public.alerts add column title text;
exception when duplicate_column then null;
end $$;

do $$ begin
  create policy "Allow service role update" on public.alerts for update using (true);
exception when duplicate_object then null;
end $$;


-- ─── 4. REALTIME for new tables ───────────────────────────────────────────

do $$ begin
  alter publication supabase_realtime add table public.readings_mirror;
exception when others then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.system_config;
exception when others then null;
end $$;


-- ─── 5. CLEANUP FUNCTION (update existing) ─────────────────────────────────

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
