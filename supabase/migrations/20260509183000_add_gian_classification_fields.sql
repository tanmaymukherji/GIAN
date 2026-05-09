alter table public.gian_sync_runs
  drop constraint if exists gian_sync_runs_status_check;

alter table public.gian_sync_runs
  add constraint gian_sync_runs_status_check
  check (status in ('queued', 'running', 'success', 'failed'));

alter table public.gian_innovations
  add column if not exists reviewed_tags text[] not null default '{}',
  add column if not exists six_m_categories text[] not null default '{}',
  add column if not exists admin_notes text;
