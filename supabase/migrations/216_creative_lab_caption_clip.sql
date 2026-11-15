-- Migration 216 — which clip a generated preview belongs to.
--
-- Write only. Not applied from this branch. Pair with "Each new clip"
-- writes one caption per usable Untested clip and sets clip_id. A later
-- generate skips a clip that already has one. Older rows stay null.

alter table creative_lab_captions
  add column if not exists clip_id uuid references creative_lab_clips (id) on delete set null;

comment on column creative_lab_captions.clip_id is
  'The clip this preview was written for. Null on rows from before this column, and on a Best clip batch that was not tied to one clip. Each new clip sets it so the next generate can tell a clip already has a preview.';

create index if not exists creative_lab_captions_clip_id_idx
  on creative_lab_captions (clip_id);
