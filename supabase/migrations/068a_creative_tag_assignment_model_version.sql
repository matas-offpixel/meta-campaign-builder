alter table creative_tag_assignments
  add column if not exists model_version text;

create index if not exists creative_tag_assignments_source_model_idx
  on creative_tag_assignments (source, model_version);

notify pgrst, 'reload schema';
