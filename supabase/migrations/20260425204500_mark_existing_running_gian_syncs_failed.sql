update public.gian_sync_runs
set
  status = 'failed',
  finished_at = coalesce(finished_at, now()),
  error_message = coalesce(error_message, 'Marked failed by repair migration after worker termination left the run in running state.'),
  updated_at = now()
where status = 'running';
