-- Migration 270 — M4a render packages (the montage render template).
--
-- Additive. Not applied from this branch; ops applies.
-- Records: docs/design-record/2026-11-25-m4-render-templates.html (RT1–RT4)
-- as re-ruled by docs/design-record/2026-11-25-m4-renders-on-yes.html (RY1–RY4).
--
-- A package is one Render press in the Lab, or one render_package call on
-- Matas's yes in Claude. Each file it renders is a creative_lab_renders row
-- with recipe set: the montage has no caption and sixteen clips, so
-- clip_id and caption_id are null on those rows (a CHECK keeps them set on
-- every caption render, as before). Owner and rights are separate (AL1).
--
-- Cost guard: one package at a time per event (the partial unique index);
-- the 60 s guard for a loop is the app's (lib/render-templates/store.ts),
-- on created_at here. The AWS billing alarm stays the backstop.

create table if not exists creative_lab_render_packages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  event_id         uuid not null references events (id) on delete cascade,
  client_id        uuid references clients (id) on delete set null,
  recipes          text[] not null,
  source           text not null check (source in ('lab', 'claude')),
  status           text not null default 'rendering' check (status in ('rendering', 'done')),
  stage            text not null check (stage in ('signup', 'presale', 'on_sale')),
  round_no         integer not null default 1 check (round_no >= 1),
  file_count       integer not null check (file_count > 0),
  -- Ids only (clip ids, the track's audio file id, the copy's voice): never person data.
  picks            jsonb not null default '{}'::jsonb,
  -- The cut plan: beat grid, drop, segments, text blocks, flashes and the cut sheet.
  plan             jsonb,
  -- RY1: the chat yes, word for word, as on its mcp_actions row (claude only).
  approval_asked   text,
  approval_answer  text,
  approved_at      timestamptz,
  cut_sheet_drive_file_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint render_packages_recipes check (
    cardinality(recipes) > 0 and recipes <@ array['montage', 'roll-call', 'top-tracks', 'artist-card']::text[]
  ),
  constraint render_packages_approval_all_or_none check (
    (approval_asked is null) = (approval_answer is null) and (approval_asked is null) = (approved_at is null)
  ),
  constraint render_packages_claude_needs_yes check (source <> 'claude' or approval_asked is not null),
  constraint render_packages_finished check ((status = 'done') = (finished_at is not null))
);

comment on table creative_lab_render_packages is
  'M4a: one render package (RT1 Render, or render_package on Matas''s yes in Claude, RY1). Its files are creative_lab_renders rows with package_id. Migration 270.';

create unique index if not exists creative_lab_render_packages_one_running
  on creative_lab_render_packages (event_id) where status = 'rendering';
create index if not exists creative_lab_render_packages_event_idx
  on creative_lab_render_packages (event_id, created_at desc);
create index if not exists creative_lab_render_packages_created_idx
  on creative_lab_render_packages (created_at desc);

alter table creative_lab_renders
  alter column clip_id drop not null,
  alter column caption_id drop not null;

alter table creative_lab_renders
  add column if not exists package_id          uuid references creative_lab_render_packages (id) on delete cascade,
  add column if not exists recipe              text,
  add column if not exists file_name           text,
  add column if not exists variant             text,
  add column if not exists round_no            integer,
  add column if not exists owner_kind          text,
  add column if not exists rights_shareable    boolean,
  add column if not exists rights_held_reason  text,
  add column if not exists checks              jsonb,
  add column if not exists storage_path        text,
  add column if not exists library_shortcut_id text;

alter table creative_lab_renders drop constraint if exists creative_lab_renders_recipe_check;
alter table creative_lab_renders
  add constraint creative_lab_renders_recipe_check
  check (recipe is null or recipe in ('montage', 'roll-call', 'top-tracks', 'artist-card'));

alter table creative_lab_renders drop constraint if exists creative_lab_renders_caption_or_recipe;
alter table creative_lab_renders
  add constraint creative_lab_renders_caption_or_recipe
  check (
    (recipe is null and clip_id is not null and caption_id is not null)
    or (
      recipe is not null and package_id is not null and file_name is not null and variant is not null
      and round_no >= 1 and owner_kind in ('artist', 'promoter', 'offpixel') and rights_shareable is not null
    )
  );

alter table creative_lab_renders drop constraint if exists creative_lab_renders_package_rights;
alter table creative_lab_renders
  add constraint creative_lab_renders_package_rights
  check (
    recipe is null
    or (
      not (owner_kind = 'promoter' and rights_shareable)
      and rights_shareable = (rights_held_reason is null)
      and (rights_held_reason is null or rights_held_reason in ('filmed', 'footage', 'branding', 'names'))
    )
  );

create index if not exists creative_lab_renders_package_idx on creative_lab_renders (package_id) where package_id is not null;
create index if not exists creative_lab_renders_drive_file_idx on creative_lab_renders (drive_file_id) where drive_file_id is not null;

comment on column creative_lab_renders.recipe is
  'M4: montage | roll-call | top-tracks | artist-card for a render package''s file; null for a caption render. Migration 270.';
comment on column creative_lab_renders.file_name is
  'The 25 Nov name {EVENT}__{owner}__{recipe}__{variant}__{cta-slug}__r{round}__{ratio}.{ext}. Migration 270.';
comment on column creative_lab_renders.checks is
  'The 8 checks and the recipe''s list, run on the file: { passed, failed: [keys], notes }. A file that failed any can''t be uploaded (RT2). Migration 270.';
comment on column creative_lab_renders.rights_shareable is
  'AL1: only a No text version made from artist material only is shareable. Owner (owner_kind) and rights are separate. Migration 270.';

-- A beat grid is derived from the track, like its drop: cached here once read.
alter table creative_lab_audio_files
  add column if not exists beat_grid    jsonb,
  add column if not exists beat_grid_at timestamptz;

comment on column creative_lab_audio_files.beat_grid is
  'M4a: the kick times read from the low end around the drop (lib/render-templates/beats.ts): { bpm, periodS, anchorS, kicks, detected, dropS }. Recomputed when drop_s changes. Migration 270.';

-- Service role writes; the owner reads their own packages (Lab and Today read through the service role).
alter table creative_lab_render_packages enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'creative_lab_render_packages' and policyname = 'Users can read their own creative_lab_render_packages'
  ) then
    execute 'create policy "Users can read their own creative_lab_render_packages" on creative_lab_render_packages for select using (auth.uid() = user_id)';
  end if;
end $$;

drop trigger if exists creative_lab_render_packages_updated_at on creative_lab_render_packages;
create trigger creative_lab_render_packages_updated_at
  before update on creative_lab_render_packages
  for each row execute procedure update_updated_at_column();

-- render_package's calls are logged as their own kind (scope mcp:render, Matas
-- only), with the chat yes in the approval columns as M3a's meta calls are.
alter table public.mcp_actions drop constraint if exists mcp_actions_kind_check;
alter table public.mcp_actions
  add constraint mcp_actions_kind_check check (kind in ('read', 'draft', 'meta', 'render'));
