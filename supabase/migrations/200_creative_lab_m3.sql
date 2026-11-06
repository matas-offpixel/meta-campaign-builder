-- Migration 200 — Creative Lab M3a: caption writer columns, round target, render attempts.
--
-- Write only. Matas applies. Does not launch anything.
--
-- Widens caption styles, stores the ad's primary text separately from the
-- burned-in overlay, and records the ad set a round will attach into (M3b
-- reads it; this migration does not call Meta).
--
-- creative_lab_style_settings has no user_id. RLS is the client's owner,
-- the same operator 197's user_id policies cover.

-- Drop every single-column check on style, whatever Postgres named it.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'creative_lab_captions'::regclass
      and con.contype = 'c'
      and att.attname = 'style'
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table creative_lab_captions drop constraint %I', r.conname);
  end loop;
end $$;

alter table creative_lab_captions
  add constraint creative_lab_captions_style_check
  check (style in (
    'lineup', 'question', 'scarcity', 'social_proof',
    'venue', 'whats_next', 'artist_first_person', 'experience', 'four_line', 'pov'
  ));

alter table creative_lab_captions
  add column if not exists primary_text text,
  add column if not exists declared_names text[] not null default '{}',
  add column if not exists size_variant text not null default 'default';

alter table creative_lab_captions drop constraint if exists creative_lab_captions_size_variant_check;
alter table creative_lab_captions
  add constraint creative_lab_captions_size_variant_check
  check (size_variant in ('default', 'long'));

comment on column creative_lab_captions.primary_text is
  'Ad copy under the post. Emoji follow creative_lab_style_settings. The overlay (text, lines) stays emoji-free.';
comment on column creative_lab_captions.size_variant is
  'default: 4 lines of 18. long: 4 lines of 24, for overlays of 73–96 characters. Renders of long refuse until the profile longApproved flag is true.';
comment on column creative_lab_captions.declared_names is
  'Names the writer says the caption uses. The validator still checks them against the event record.';

create table if not exists creative_lab_style_settings (
  client_id          uuid not null references clients (id) on delete cascade,
  style              text not null check (style in (
    'lineup', 'question', 'scarcity', 'social_proof',
    'venue', 'whats_next', 'artist_first_person', 'experience', 'four_line', 'pov'
  )),
  emoji_in_primary   boolean not null default true,
  primary key (client_id, style)
);

comment on table creative_lab_style_settings is
  'Per client and caption style. emoji_in_primary applies to primary text only. Overlay emoji are not configurable in M3. Migration 200.';

alter table creative_lab_style_settings enable row level security;
drop policy if exists "Users can manage their own creative_lab_style_settings" on creative_lab_style_settings;
create policy "Users can manage their own creative_lab_style_settings"
  on creative_lab_style_settings
  for all
  using (
    exists (
      select 1 from clients c
      where c.id = creative_lab_style_settings.client_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from clients c
      where c.id = creative_lab_style_settings.client_id
        and c.user_id = auth.uid()
    )
  );

-- The approved-at check also mentions status. Leave that one. Drop only the enum.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'creative_lab_rounds'::regclass
      and con.contype = 'c'
      and att.attname = 'status'
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table creative_lab_rounds drop constraint %I', r.conname);
  end loop;
end $$;

alter table creative_lab_rounds
  add constraint creative_lab_rounds_status_check
  check (status in ('draft', 'rendering', 'approved', 'rejected', 'launched', 'judged'));

alter table creative_lab_rounds
  add column if not exists ad_account_id text,
  add column if not exists meta_campaign_id text,
  add column if not exists meta_adset_id text,
  add column if not exists page_id text,
  add column if not exists instagram_actor_id text,
  add column if not exists destination_url text,
  add column if not exists cta text;

comment on column creative_lab_rounds.meta_adset_id is
  'The ad set the operator picked for round 1. Later rounds copy it. M3b attaches here, paused. Nothing in M3a calls Meta.';

alter table creative_lab_round_ads
  add column if not exists render_id uuid references creative_lab_renders (id) on delete set null,
  add column if not exists launch_state text not null default 'pending',
  add column if not exists launch_error text;

alter table creative_lab_round_ads drop constraint if exists creative_lab_round_ads_launch_state_check;
alter table creative_lab_round_ads
  add constraint creative_lab_round_ads_launch_state_check
  check (launch_state in ('pending', 'render_failed', 'ready', 'launched', 'launch_failed'));

comment on column creative_lab_round_ads.launch_state is
  'Render and launch progress. A failed render sets render_failed. verdict stays null until the judge writes it.';

alter table creative_lab_renders
  add column if not exists attempt integer not null default 1;

comment on column creative_lab_renders.attempt is
  'Starts at 1. A retry increments it. The file is videos/creative-lab/{id}-9x16.mp4, or -a{attempt}- when attempt is above 1, so a retry does not collide with upsert false.';

comment on column creative_lab_clips.event_id is
  'The show the clip was filmed at. Null for a presskit clip. A crowd number is allowed only when this event''s tickets sold are at least the number claimed; null rejects the claim.';

notify pgrst, 'reload schema';
