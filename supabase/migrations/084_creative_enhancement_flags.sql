-- Creative enhancement policy violations — scanner persists OPT_IN / DEFAULT_OPT_IN
-- against agency policy for Meta Advantage+ features (see lib/meta/enhancement-policy.ts).

create table if not exists creative_enhancement_flags (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  creative_id text not null,
  ad_account_id text not null,
  client_id uuid not null references clients (id) on delete cascade,
  event_id uuid references events (id) on delete set null,
  campaign_id text,
  ad_name text,
  flagged_features jsonb not null,
  severity_score integer not null,
  raw_features_spec jsonb not null,
  scanned_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  unique (ad_id, scanned_at)
);

create index if not exists idx_cef_client_unresolved
  on creative_enhancement_flags (client_id, resolved_at)
  where resolved_at is null;

create index if not exists idx_cef_event_unresolved
  on creative_enhancement_flags (event_id, resolved_at)
  where resolved_at is null;

create index if not exists idx_cef_client_scanned_at
  on creative_enhancement_flags (client_id, scanned_at desc);

alter table creative_enhancement_flags enable row level security;

comment on table creative_enhancement_flags is
  'Meta creative enhancement policy violations; writes via service-role scanner, reads via ownership-checked API.';

notify pgrst, 'reload schema';
