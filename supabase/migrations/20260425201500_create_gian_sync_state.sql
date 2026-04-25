create table if not exists public.gian_sync_state (
  state_key text primary key,
  next_offset integer not null default 0,
  last_total integer not null default 0,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  updated_at timestamptz not null default now()
);
