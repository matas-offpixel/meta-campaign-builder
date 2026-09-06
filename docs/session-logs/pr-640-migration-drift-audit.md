# Session log — migration drift audit

## PR

- **Number:** pending
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/640
- **Branch:** `cursor/migration-drift-audit`

## Summary

Post-P0 audit (triggered by PR #639 finding migration 042 missing from prod).
Diffed `supabase/migrations/*.sql` (local names) against `supabase_migrations.schema_migrations`
on project `zbtldbfjbhfvpksmdvnt`, normalising names in both directions. Found and
applied 3 genuinely missing migrations: `075` (DDL gap — missing unique index on
`additional_ticket_entries`), `088` (DML backfill, idempotent no-op), `108` (DML
DELETE, idempotent no-op). All remaining gaps classified as pre-history (schema
objects confirmed present), name discrepancies (same content under different ledger
name), or prod-only ops entries.

## Scope / files

- `docs/audits/migration-drift-audit-2026-06-29.md` — full audit table with
  classification and evidence for every gap.
- Prod DB (ops-only): applied `075_additional_ticket_entries_running_total_key`,
  `088_cl_final_tier_channel_backfill`, `108_ironworks_spark_backfill_2` via MCP.
  No app-code changes.

## Validation

- [x] `list_migrations` before + after confirms all three now in ledger.
- [x] `pg_indexes` confirms `additional_ticket_entries_natural_key_idx` present.
- [x] Final re-diff: no remaining on-disk files with an unaccounted-for gap.
- [ ] `npx tsc --noEmit` / `npm run build` — no app code changed; not required.
