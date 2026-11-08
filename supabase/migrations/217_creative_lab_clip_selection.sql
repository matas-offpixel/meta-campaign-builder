-- Creative Lab clip selection. Written, not applied.
-- all: every usable clip is selected. chosen: the rows below decide.
-- A new clip is selected only while the mode is all.

alter table events
  add column if not exists clip_selection_mode text not null default 'all';

alter table events drop constraint if exists events_clip_selection_mode_check;
alter table events
  add constraint events_clip_selection_mode_check
  check (clip_selection_mode in ('all', 'chosen'));

comment on column events.clip_selection_mode is
  'all: every usable clip is selected. chosen: creative_lab_clip_selections decides. Migration 217.';

create table if not exists creative_lab_clip_selections (
  event_id  uuid not null references events (id) on delete cascade,
  clip_id   uuid not null references creative_lab_clips (id) on delete cascade,
  selected  boolean not null,
  set_by    uuid references auth.users (id) on delete set null,
  set_at    timestamptz not null default now(),
  user_id   uuid not null references auth.users (id) on delete cascade,
  primary key (event_id, clip_id)
);

comment on table creative_lab_clip_selections is
  'Which clips an event has chosen. Ignored while events.clip_selection_mode is all. Migration 217.';

alter table creative_lab_clip_selections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_lab_clip_selections'
      and policyname = 'Users can manage their own creative_lab_clip_selections'
  ) then
    create policy "Users can manage their own creative_lab_clip_selections"
      on creative_lab_clip_selections
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
