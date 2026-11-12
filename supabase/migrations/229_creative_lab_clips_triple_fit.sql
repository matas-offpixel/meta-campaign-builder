-- Migration 229 — creative_lab_clips: one made triple-fit per landscape.
--
-- Write only. Not applied from this branch; Matas applies from main.
--
-- A landscape clip that cannot make its own 9:16, and whose part window
-- is still at least 675 px, stays in the Lab (O108). "Make a triple-fit"
-- writes a second clip row that points at that source. The new row is a
-- 9:16 clip: it can join a round, render, and launch. The source row is
-- unchanged. One made clip per source. Deleting the source removes it.

alter table creative_lab_clips
  add column if not exists triple_fit_source_id uuid references creative_lab_clips (id) on delete cascade;

create unique index if not exists creative_lab_clips_one_triple_fit_per_source
  on creative_lab_clips (triple_fit_source_id)
  where triple_fit_source_id is not null;

comment on column creative_lab_clips.triple_fit_source_id is
  'The landscape clip this row was made from. Set means this clip is a 9:16 triple-fit and is not a single crop of the file.';
