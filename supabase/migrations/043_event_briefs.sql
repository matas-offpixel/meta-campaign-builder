-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 043 — event_briefs, service_tiers, brief_intake_tokens
--
-- Foundation for the brief → Off/Pixel template → app-generated campaign flow
-- (see docs/STRATEGIC_REFLECTION_2026-04-23.md §3, roadmap items 6, 7, 13).
--
-- Why three tables:
--   1) event_briefs — one row per event; holds structured fields + jsonb
--      free-form (raw_answers) for client intake, tier selection, and
--      hand-off notes. Auth-scoped (user_id) like other event-owned rows.
--   2) service_tiers — global product/pricing lookup (no user_id). Seeded
--      from the public quote page + internal commercial rules; the app
--      references tier_key. Inserts/updates are migrations / service role
--      only, not per-user CRUD.
--   3) brief_intake_tokens — URL token minted for the (future) public
--      intake form, mirroring report_shares: the route resolves
--      token → event_id + user_id with the service-role client, then
--      writes the brief without an end-user Supabase session.
--
-- If migration 042 was already claimed (e.g. d2c credentials), this is 043.
--
-- After applying, regenerate types:
--   npx supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

-- Reuse the shared touch trigger from earlier migrations.
create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ══ service_tiers (global) ═══════════════════════════════════════════════════

create table if not exists service_tiers (
  key                        text            primary key,
  label                      text            not null,
  cap_min                    integer,
  cap_max                    integer,
  focus_variables_max        integer         not null,
  default_ads_creatives_min  integer         not null default 5,
  default_ads_refresh_weeks    integer         not null default 2,
  price_min_gbp              numeric(10, 2),
  price_cap_gbp              numeric(10, 2),
  description                text
);

comment on table service_tiers is
  'Global service tier lookup. Seeds from offpixel.co.uk/quote + commercial caps; RLS: authenticated SELECT only, writes via migration/service role.';

-- ══ event_briefs ═══════════════════════════════════════════════════════════

create table if not exists event_briefs (
  id                     uuid         primary key default gen_random_uuid(),
  user_id                uuid         not null references auth.users (id) on delete cascade,
  event_id               uuid         not null unique references events (id) on delete cascade,
  tier_key               text         references service_tiers (key) on delete restrict,
  brand_voice_notes      text,
  creative_brief_notes   text,
  brand_kit_url          text,
  footage_drive_url      text,
  target_audience_notes  text,
  d2c_channels           text[]       not null default '{}'
    check (
      d2c_channels
      <@ array['email','whatsapp_dm','whatsapp_community','sms']::text[]
    ),
  ads_channels           text[]       not null default '{}'
    check (
      ads_channels
      <@ array['meta','tiktok','google']::text[]
    ),
  expected_budget_gbp    numeric(12, 2),
  presale_signup_url     text,
  raw_answers            jsonb        not null default '{}'::jsonb,
  submitted_at           timestamptz,
  submitted_by_email     text,
  notes_for_offpixel     text,
  created_at             timestamptz  not null default now(),
  updated_at             timestamptz  not null default now()
);

create index if not exists event_briefs_event_id_idx
  on event_briefs (event_id);

create index if not exists event_briefs_user_id_idx
  on event_briefs (user_id);

create trigger event_briefs_updated_at
  before update on event_briefs
  for each row execute function update_updated_at_column();

comment on table event_briefs is
  'Client brief data keyed by event. submitted_at set when the intake form is submitted.';

-- ══ brief_intake_tokens (mirror report_shares) ════════════════════════════

create table if not exists brief_intake_tokens (
  token           text         primary key,
  event_id        uuid         not null references events (id) on delete cascade,
  user_id         uuid         not null references auth.users (id) on delete cascade,
  enabled         boolean      not null default true,
  expires_at      timestamptz,
  view_count      integer      not null default 0,
  submitted_at    timestamptz,
  last_viewed_at  timestamptz,
  created_at      timestamptz  not null default now()
);

create index if not exists brief_intake_tokens_event_id_idx
  on brief_intake_tokens (event_id);

create index if not exists brief_intake_tokens_user_id_idx
  on brief_intake_tokens (user_id);

comment on table brief_intake_tokens is
  'Public brief-intake link tokens. Same RLS as report_shares; resolve server-side with service role.';

-- ══ Seed service_tiers ═════════════════════════════════════════════════════

insert into service_tiers (
  key,
  label,
  cap_min,
  cap_max,
  focus_variables_max,
  default_ads_creatives_min,
  default_ads_refresh_weeks,
  price_min_gbp,
  price_cap_gbp,
  description
)
values
  (
    'small',
    'Small',
    0,
    2000,
    2,
    5,
    2,
    750.00,
    null,
    'Under £2k ad cap; 1–2 focus variables. Minimum project £750. Aligns to offpixel.co.uk/quote Small.'
  ),
  (
    'medium',
    'Medium',
    2000,
    4000,
    3,
    5,
    2,
    null,
    null,
    '£2k–4k ad cap; 1–3 focus variables.'
  ),
  (
    'large',
    'Large',
    4000,
    10000,
    4,
    5,
    2,
    null,
    4000.00,
    '£4k–10k ad cap; 1–4 focus variables. Default project cap £4,000 where applicable.'
  ),
  (
    'xtra_large',
    'Xtra large',
    10000,
    null,
    5,
    5,
    2,
    4500.00,
    5000.00,
    '£10k+ ad cap; 1–5 focus variables. Commercial: £4,500 from £14k+ spend, £5,000 from £19k+ (see quote page / preferences).'
  )
on conflict (key) do nothing;

-- ══ RLS: service_tiers (authenticated read-only) ══════════════════════════

alter table service_tiers enable row level security;

-- No owner column — all authenticated app users can read the catalog.
-- Writes only via service role / superuser (migrations, admin).
create policy "service_tiers_authenticated_read"
  on service_tiers for select
  to authenticated
  using (true);

-- ══ RLS: event_briefs (per user) ═════════════════════════════════════════════

alter table event_briefs enable row level security;

create policy "event_briefs_owner_read"
  on event_briefs for select
  using (auth.uid() = user_id);

create policy "event_briefs_owner_insert"
  on event_briefs for insert
  with check (auth.uid() = user_id);

create policy "event_briefs_owner_update"
  on event_briefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "event_briefs_owner_delete"
  on event_briefs for delete
  using (auth.uid() = user_id);

-- ══ RLS: brief_intake_tokens (same as report_shares) ══════════════════════

alter table brief_intake_tokens enable row level security;

create policy "brief_intake_tokens_owner_read"
  on brief_intake_tokens for select
  using (auth.uid() = user_id);

create policy "brief_intake_tokens_owner_insert"
  on brief_intake_tokens for insert
  with check (auth.uid() = user_id);

create policy "brief_intake_tokens_owner_update"
  on brief_intake_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "brief_intake_tokens_owner_delete"
  on brief_intake_tokens for delete
  using (auth.uid() = user_id);

-- ══ PostgREST schema cache ════════════════════════════════════════════════

notify pgrst, 'reload schema';
