-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 — Creative templates + render history.
--
-- Scaffolding for the Canva-Autofill / Bannerbear / Placid pipeline. The
-- providers are stubs in this PR (gated behind FEATURE_CANVA_AUTOFILL,
-- FEATURE_BANNERBEAR, FEATURE_PLACID) so launching live rendering is
-- a single env-var flip per provider once enterprise approvals clear.
--
-- Two tables:
--
--   creative_templates  — per-user template registry. `external_template_id`
--                         points at the provider's template object; `fields_jsonb`
--                         records the schema of variables the template accepts
--                         so the render UI can prompt for them.
--                         provider: canva | bannerbear | placid | manual.
--                         channel:  feed | story | reel | display | other.
--                         aspect_ratios: text[] of allowed ratios (e.g. ['1:1','9:16']).
--
--   creative_renders    — per-event render queue / history. status:
--                         queued | rendering | done | failed. asset_url is
--                         the resulting CDN URL on success; provider_job_id
--                         is the polling handle.
--
-- The 'manual' provider is intentionally included in the check constraint —
-- it lets users register a template they generate by hand outside the
-- system so the same UI can browse + reuse them.
--
-- After applying:
--   npx supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists creative_templates (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users (id) on delete cascade,
  name                   text        not null,
  provider               text        not null
    check (provider in ('canva', 'bannerbear', 'placid', 'manual')),
  external_template_id   text,
  fields_jsonb           jsonb       not null default '[]'::jsonb,
  channel                text        not null default 'feed'
    check (channel in ('feed', 'story', 'reel', 'display', 'other')),
  aspect_ratios          text[]      not null default array['1:1']::text[],
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table  creative_templates is
  'Per-user creative template registry. Provider-agnostic; pivots Canva, Bannerbear, Placid templates plus manual entries onto a single library used by the renders pipeline + the autofill UI.';
comment on column creative_templates.fields_jsonb is
  'Array of field descriptors: [{key, label, type: text|image|color|number, required?: bool}]. Drives the render form so the user knows which variables the template needs at autofill time.';

create index if not exists creative_templates_provider_idx
  on creative_templates (user_id, provider);
create index if not exists creative_templates_channel_idx
  on creative_templates (user_id, channel);

create table if not exists creative_renders (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users (id) on delete cascade,
  event_id         uuid        references events (id) on delete set null,
  template_id      uuid        not null references creative_templates (id) on delete cascade,
  status           text        not null default 'queued'
    check (status in ('queued', 'rendering', 'done', 'failed')),
  asset_url        text,
  provider_job_id  text,
  fields_jsonb     jsonb       not null default '{}'::jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table  creative_renders is
  'Per-render row created by the autofill UI. status walks queued → rendering → done | failed. Polled via provider.pollRender(provider_job_id). Fields_jsonb records the variables the user provided for the render.';

create index if not exists creative_renders_event_idx
  on creative_renders (event_id, created_at desc);
create index if not exists creative_renders_status_idx
  on creative_renders (status, created_at asc)
  where status in ('queued', 'rendering');
create index if not exists creative_renders_template_idx
  on creative_renders (template_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table creative_templates enable row level security;
alter table creative_renders   enable row level security;

drop policy if exists ct_owner_select on creative_templates;
create policy ct_owner_select on creative_templates
  for select using (auth.uid() = user_id);
drop policy if exists ct_owner_insert on creative_templates;
create policy ct_owner_insert on creative_templates
  for insert with check (auth.uid() = user_id);
drop policy if exists ct_owner_update on creative_templates;
create policy ct_owner_update on creative_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists ct_owner_delete on creative_templates;
create policy ct_owner_delete on creative_templates
  for delete using (auth.uid() = user_id);

drop policy if exists cr_owner_select on creative_renders;
create policy cr_owner_select on creative_renders
  for select using (auth.uid() = user_id);
drop policy if exists cr_owner_insert on creative_renders;
create policy cr_owner_insert on creative_renders
  for insert with check (auth.uid() = user_id);
drop policy if exists cr_owner_update on creative_renders;
create policy cr_owner_update on creative_renders
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists cr_owner_delete on creative_renders;
create policy cr_owner_delete on creative_renders
  for delete using (auth.uid() = user_id);

-- ── updated_at touch triggers ───────────────────────────────────────────

create or replace function set_creative_templates_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ct_set_updated_at on creative_templates;
create trigger ct_set_updated_at
  before update on creative_templates
  for each row execute function set_creative_templates_updated_at();

create or replace function set_creative_renders_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cr_set_updated_at on creative_renders;
create trigger cr_set_updated_at
  before update on creative_renders
  for each row execute function set_creative_renders_updated_at();

notify pgrst, 'reload schema';
