-- A client's own Instagram clips are candidates before they are footage.
-- artist_id stays set on an artist's candidate and is null on the
-- client's. Add imports a client candidate as promoter footage.
-- Written, not applied.

alter table creative_lab_ig_candidates add column if not exists client_id uuid references clients (id) on delete cascade;

alter table creative_lab_ig_candidates alter column artist_id drop not null;

alter table creative_lab_ig_candidates drop constraint if exists creative_lab_ig_candidates_owner_check;
alter table creative_lab_ig_candidates
  add constraint creative_lab_ig_candidates_owner_check
  check (
    (artist_id is not null and client_id is null)
    or (artist_id is null and client_id is not null)
  );

alter table creative_lab_ig_candidates drop constraint if exists creative_lab_ig_candidates_client_media;
alter table creative_lab_ig_candidates
  add constraint creative_lab_ig_candidates_client_media unique (client_id, ig_media_id);
