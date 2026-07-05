-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 140 — event_signups anonymisation support (OP909 admin Sprint 2
-- PR 6: fan detail view). Backs the "anonymise" action next to the existing
-- soft-delete (deleted_at, migration 137).
--
-- WHY a schema change: GDPR erasure on a CANONICAL signup nulls its encrypted
-- PII (email/phone). But the migration-134 `event_signups_contactable_check`
-- requires email_encrypted OR phone_encrypted OR deduplicated_signup_id to be
-- non-null — so nulling both contact blobs on a canonical row (which has no
-- deduplicated_signup_id) would VIOLATE the CHECK. We add an `anonymized_at`
-- stamp and extend the CHECK with `OR anonymized_at is not null`.
--
-- This CHECK change is strictly MORE PERMISSIVE (adds an OR branch), so it can
-- never reject a row that was valid before — zero risk to existing data or the
-- signup write path (which never sets anonymized_at).
--
-- Difference from deleted_at:
--   * deleted_at   — hide the row from the admin UI / exports / analytics; PII
--                    + dedupe hashes STAY (a re-signup still dedupes). Reversible.
--   * anonymized_at — irreversible PII erasure: the anonymise action nulls
--                    email/phone blobs + hashes + handles + user_agent +
--                    referrer + utm. The row stays for aggregate integrity
--                    (geo, timestamps, event) but is no longer contactable or
--                    identifiable. Anonymised rows are also treated as deleted
--                    by the admin surfaces.
--
-- Reversibility:
--   alter table event_signups drop constraint if exists event_signups_contactable_check;
--   alter table event_signups add constraint event_signups_contactable_check check (
--     email_encrypted is not null or phone_encrypted is not null
--     or deduplicated_signup_id is not null);
--   alter table event_signups drop column if exists anonymized_at;
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: re-running drops + re-adds the CHECK to the same final state.
-- ─────────────────────────────────────────────────────────────────────────────

alter table event_signups
  add column if not exists anonymized_at timestamptz;

comment on column event_signups.anonymized_at is
  'Irreversible PII-erasure stamp set from the admin fan detail view (OP909 PR 6). When set, the anonymise action has nulled email/phone blobs + hashes, handles, user_agent, referrer and utm; the row is retained for aggregate integrity (geo/timestamps/event) but is no longer contactable. Treated as deleted by the admin UI. Migration 140.';

-- Extend the contactable CHECK so an anonymised canonical row (both contact
-- blobs nulled, no deduplicated_signup_id) is still valid.
alter table event_signups
  drop constraint if exists event_signups_contactable_check;

alter table event_signups
  add constraint event_signups_contactable_check check (
    email_encrypted is not null
    or phone_encrypted is not null
    or deduplicated_signup_id is not null
    or anonymized_at is not null
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block — raises inside the migration transaction on any miss.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
begin
  -- Column present with the right type.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_signups'
    and column_name = 'anonymized_at'
    and data_type = 'timestamp with time zone';
  if v_count <> 1 then
    raise exception 'migration 140 verification: anonymized_at missing or wrong type';
  end if;

  -- The (relaxed) contactable CHECK exists.
  select count(*) into v_count
  from pg_constraint
  where contype = 'c'
    and conrelid = 'public.event_signups'::regclass
    and conname = 'event_signups_contactable_check';
  if v_count <> 1 then
    raise exception 'migration 140 verification: contactable CHECK missing after rebuild';
  end if;

  -- The CHECK definition now references anonymized_at (proves we relaxed it,
  -- not just re-created the old one).
  select count(*) into v_count
  from pg_constraint
  where conname = 'event_signups_contactable_check'
    and conrelid = 'public.event_signups'::regclass
    and pg_get_constraintdef(oid) ilike '%anonymized_at%';
  if v_count <> 1 then
    raise exception 'migration 140 verification: contactable CHECK does not reference anonymized_at';
  end if;

  raise notice 'migration 140 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
