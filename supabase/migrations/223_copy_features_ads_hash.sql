-- Migration 223 — copy_features.ads_hash (insights rail issue 3, R21)
--
-- copy_features stores counts, not the ads behind a row, so two features
-- with the same counts cannot be told apart. The job writes ads_hash:
-- sha256 of the sorted Meta ad ids that fed the row. Equal hashes are
-- one population. Rows written before this column stay null and never
-- collapse. Nullable. No existing row is rewritten here.

alter table copy_features add column if not exists ads_hash text;

comment on column copy_features.ads_hash is
  'sha256 of the sorted Meta ad ids behind the row. Null on rows from before the column; a null never collapses with another row.';
