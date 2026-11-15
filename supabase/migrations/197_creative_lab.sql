-- Migration 197 — Creative Lab M1: data model
--
-- Artist clips × event captions, tested in rounds and judged weekly from
-- ad_daily_insights (lib/creative-lab/judge.ts). Spec:
-- docs/session-logs/creative-lab-roadmap-2026-11-05.md and
-- docs/session-logs/creative-lab-m1-review-2026-11-05.md.
--
-- One round ad (clip × caption) can run as several Meta ads, one per ad
-- set it is attached into; creative_lab_round_ad_launches holds those.
-- creative_lab_renders is written by M2 (caption render), the launch
-- rows by M3 (round builder + attach). Both are here so neither milestone
-- needs another migration.
--
-- Also widens three creative-tag CHECKs so caption_style can be a tag
-- dimension written with source 'creative_lab'.
--
-- Owner-only RLS through user_id, same shape as 193. Writes from crons
-- and scripts are service role. Apply by hand: prod first, then CI.
-- Idempotent: if not exists + catalog-checked policies.

create table if not exists creative_lab_artists (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  client_id           uuid not null references clients (id) on delete cascade,
  name                text not null,
  ig_username         text,
  tiktok_identity_id  text,
  rights_doc_ref      text,
  approved_by         text,
  approved_at         timestamptz,
  starting_caption    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, name),
  constraint creative_lab_artists_approval_needs_rights
    check (approved_at is null or rights_doc_ref is not null)
);

comment on table creative_lab_artists is
  'An artist whose content a client may use in paid Creative Lab rounds. No round is built without rights_doc_ref and approved_at (roadmap §2 rule 6). Migration 197.';
comment on column creative_lab_artists.rights_doc_ref is
  'Where the written paid-use permission is stored (a link or file reference). Required before approval.';

create table if not exists creative_lab_event_facts (
  event_id       uuid primary key references events (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  lineup         text[] not null default '{}',
  allowed_dates  date[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table creative_lab_event_facts is
  'Facts a caption may state beyond the events row. events.notes is free text and is never read for names. Migration 197.';
comment on column creative_lab_event_facts.lineup is
  'Every name a caption may put on this event, as billed (e.g. Phill de Janeiro).';
comment on column creative_lab_event_facts.allowed_dates is
  'Dates other than events.event_date a caption may state: presale, general sale.';

create table if not exists creative_lab_clips (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  artist_id              uuid not null references creative_lab_artists (id) on delete cascade,
  event_id               uuid references events (id) on delete set null,
  clip_no                integer not null check (clip_no > 0),
  creative_asset_id      uuid not null references creative_assets (id) on delete restrict,
  source                 text not null check (source in ('spark', 'file', 'instagram', 'presskit')),
  external_id            text,
  permalink              text,
  rights_ref             text not null,
  audio_status           text not null default 'original'
    check (audio_status in ('original', 'muted', 'replaced', 'cleared')),
  in_s                   numeric check (in_s is null or in_s >= 0),
  out_s                  numeric,
  ig_like_count          integer,
  ig_comments_count      integer,
  ig_followers_at_fetch  integer,
  ig_posted_at           timestamptz,
  fetched_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (artist_id, clip_no),
  constraint creative_lab_clips_trim_order check (in_s is null or out_s is null or out_s > in_s)
);

create unique index if not exists creative_lab_clips_artist_source_external_key
  on creative_lab_clips (artist_id, source, external_id)
  where external_id is not null;

comment on table creative_lab_clips is
  'A source clip. The file is a creative_assets row (sha256, aspect, duration, storage path); never a signed URL. event_id is null for presskit clips. Migration 197.';
comment on column creative_lab_clips.clip_no is
  'Stable per artist; the clipNN in ad names.';
comment on column creative_lab_clips.rights_ref is
  'The permission this clip is used under: the Spark authorisation, the file hand-over, or the post the written permission names.';
comment on column creative_lab_clips.audio_status is
  'original: the clip''s own audio. muted / replaced: Meta may mute released music; replaced means a cleared track. cleared: original audio confirmed cleared.';

create table if not exists creative_lab_captions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  event_id       uuid not null references events (id) on delete cascade,
  style          text not null check (style in ('lineup', 'question', 'scarcity', 'social_proof')),
  caption_no     integer not null check (caption_no > 0),
  text           text not null,
  lines          text[] not null,
  style_version  text not null,
  generated_by   text not null,
  status         text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  facts_hash     text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (event_id, style, caption_no)
);

comment on table creative_lab_captions is
  'A caption validated against the event facts (lib/creative-lab/caption-facts.ts). lines are the exact breaks the renderer draws. Migration 197.';
comment on column creative_lab_captions.caption_no is
  'Stable per event and style; the <style><N> in ad names.';
comment on column creative_lab_captions.generated_by is
  'manual, or the model id that wrote it.';
comment on column creative_lab_captions.facts_hash is
  'sha256 of the canonical facts JSON the text was validated against. Tier stock changes it; re-validate before approval.';

create table if not exists creative_lab_rounds (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  event_id     uuid not null references events (id) on delete cascade,
  artist_id    uuid not null references creative_lab_artists (id) on delete cascade,
  round_no     integer not null check (round_no > 0),
  channel      text not null default 'meta' check (channel in ('meta', 'tiktok')),
  draft_id     uuid references campaign_drafts (id) on delete set null,
  status       text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'launched', 'judged')),
  approved_by  text,
  built_at     timestamptz not null default now(),
  approved_at  timestamptz,
  launched_at  timestamptz,
  judged_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (event_id, artist_id, round_no),
  constraint creative_lab_rounds_approved_has_time
    check (status not in ('approved', 'launched', 'judged') or approved_at is not null)
);

comment on table creative_lab_rounds is
  'One test round for an artist on an event. Drafts are built paused; Matas approves every round. Judged across every ad set its ads run in. Migration 197.';
comment on column creative_lab_rounds.draft_id is
  'The campaign_drafts row the attach flow launches from (M3).';

create table if not exists creative_lab_round_ads (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  round_id                 uuid not null references creative_lab_rounds (id) on delete cascade,
  clip_id                  uuid not null references creative_lab_clips (id) on delete restrict,
  caption_id               uuid not null references creative_lab_captions (id) on delete restrict,
  ad_name                  text not null,
  role                     text not null default 'challenger' check (role in ('control', 'challenger')),
  retest_of                uuid references creative_lab_round_ads (id) on delete set null,
  verdict                  text check (verdict in ('untested', 'thin', 'loser', 'winner', 'flagged')),
  verdict_reason           text,
  confirmed                boolean not null default false,
  result_metric            text,
  verdict_spend_share      numeric,
  verdict_fair_share       numeric,
  verdict_cost_per_result  numeric,
  verdict_results          integer,
  window_start             date,
  window_end               date,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (round_id, ad_name),
  unique (round_id, clip_id, caption_id),
  constraint creative_lab_round_ads_ad_name_ascii check (ad_name ~ '^[A-Za-z0-9_-]+$')
);

comment on table creative_lab_round_ads is
  'One clip × caption in a round. ad_name is ASCII only (<ARTIST>-clip<NN>_cap-<style><N>) so it survives metaAdName unchanged. Verdict columns are written by scripts/creative-lab-judge.mts --apply. Migration 197.';
comment on column creative_lab_round_ads.retest_of is
  'The earlier round ad this one re-tests. confirmed is true only when both won and this one has at least 10 results.';
comment on column creative_lab_round_ads.verdict is
  'Null until judged, and when the ad lands between the bands (see verdict_reason). lib/creative-lab/judge.ts.';
comment on column creative_lab_round_ads.result_metric is
  'What a result was: the ad set''s optimisation event (e.g. initiate_checkout, complete_registration), else purchase.';

create table if not exists creative_lab_round_ad_launches (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  round_ad_id       uuid not null references creative_lab_round_ads (id) on delete cascade,
  meta_ad_id        text not null unique,
  meta_adset_id     text not null,
  meta_campaign_id  text,
  ad_account_id     text,
  created_at        timestamptz not null default now()
);

comment on table creative_lab_round_ad_launches is
  'Each Meta ad a round ad runs as, one per ad set it was attached into. The judge reads every ad set listed here. Migration 197.';

create table if not exists creative_lab_renders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  clip_id            uuid not null references creative_lab_clips (id) on delete cascade,
  caption_id         uuid not null references creative_lab_captions (id) on delete cascade,
  style_version      text not null,
  aspect             text not null check (aspect in ('9:16', '4:5')),
  creative_asset_id  uuid references creative_assets (id) on delete set null,
  render_ms          integer,
  ssim               numeric,
  status             text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (clip_id, caption_id, style_version, aspect)
);

comment on table creative_lab_renders is
  'M2: one rendered mp4 per clip × caption × style version × aspect. The output is a creative_assets row. ssim is the reference-frame check on the caption region. Migration 197.';

create index if not exists creative_lab_artists_client_idx on creative_lab_artists (client_id);
create index if not exists creative_lab_clips_artist_idx on creative_lab_clips (artist_id);
create index if not exists creative_lab_captions_event_idx on creative_lab_captions (event_id);
create index if not exists creative_lab_rounds_event_idx on creative_lab_rounds (event_id);
create index if not exists creative_lab_round_ads_round_idx on creative_lab_round_ads (round_id);
create index if not exists creative_lab_round_ad_launches_round_ad_idx on creative_lab_round_ad_launches (round_ad_id);
create index if not exists creative_lab_round_ad_launches_adset_idx on creative_lab_round_ad_launches (meta_adset_id);
create index if not exists creative_lab_renders_clip_idx on creative_lab_renders (clip_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'creative_lab_artists',
    'creative_lab_event_facts',
    'creative_lab_clips',
    'creative_lab_captions',
    'creative_lab_rounds',
    'creative_lab_round_ads',
    'creative_lab_round_ad_launches',
    'creative_lab_renders'
  ] loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = format('Users can manage their own %s', t)
    ) then
      execute format(
        'create policy %I on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        format('Users can manage their own %s', t),
        t
      );
    end if;
  end loop;

  foreach t in array array[
    'creative_lab_artists',
    'creative_lab_event_facts',
    'creative_lab_clips',
    'creative_lab_captions',
    'creative_lab_rounds',
    'creative_lab_round_ads',
    'creative_lab_renders'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute procedure update_updated_at_column()',
      t || '_updated_at',
      t
    );
  end loop;
end $$;

-- caption_style is a tag dimension written by the Lab (source 'creative_lab').
-- It is not in CREATIVE_TAG_DIMENSIONS, so the AI auto-tagger never sees it.
alter table creative_tags drop constraint if exists creative_tags_motion_dimension_check;
alter table creative_tags
  add constraint creative_tags_motion_dimension_check
  check (
    dimension is null
    or dimension in (
      'asset_type', 'visual_format', 'messaging_angle', 'intended_audience',
      'hook_tactic', 'headline_tactic', 'offer_type', 'seasonality',
      'caption_style'
    )
  );

alter table creative_tags drop constraint if exists creative_tags_motion_source_check;
alter table creative_tags
  add constraint creative_tags_motion_source_check
  check (source in ('motion_seed', 'curated', 'custom', 'creative_lab'));

alter table creative_tag_assignments drop constraint if exists creative_tag_assignments_source_check;
alter table creative_tag_assignments
  add constraint creative_tag_assignments_source_check
  check (source in ('manual', 'ai', 'creative_lab'));

notify pgrst, 'reload schema';
