-- Track when each client's Meta ad account was last scanned for enhancement policy
-- violations (write by scanner, read by banner to show "Last scan: N min ago").

alter table clients
  add column if not exists last_probed_at timestamptz;

notify pgrst, 'reload schema';
