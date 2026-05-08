# Session log — fix/cl-final-tier-channel-sales-backfill

## PR

- **Number:** #367
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/367
- **Branch:** `fix/cl-final-tier-channel-sales-backfill`

## Summary

Fix the fourthefans live rollup bridge so provider-owned ticket tier
snapshots also populate the client's automatic `4TF` channel in
`tier_channel_sales`. The write is intentionally narrow: it only targets
the `(event_id, tier_name, 4TF channel_id)` natural key, uses service-role,
and never deletes/null-refills any event or operator channel rows.

Backfilled the four Arsenal CL Final London venue rows from existing
`event_ticket_tiers` into `tier_channel_sales`.

## Scope

- `lib/db/ticketing.ts` — add `upsertProviderTierChannelSales`.
- `lib/dashboard/rollup-sync-runner.ts` — call provider channel sync after
  `replaceEventTicketTiers` for fourthefans merged tiers.
- `supabase/migrations/088_cl_final_tier_channel_backfill.sql` — insert-only
  CL Final 4TF channel backfill.
- `lib/ticketing/CONTRACT.md` — update the channel ownership contract:
  sync owns only the provider automatic channel, not operator channels.
- Tests:
  - `lib/dashboard/__tests__/tier-channel-fallback.test.ts`
  - `lib/ticketing/__tests__/rollup-sync-channel-safety.test.ts`

## Validation

- [x] Focused PR-1 tests pass:
  `npm test -- lib/dashboard/__tests__/tier-channel-fallback.test.ts lib/ticketing/__tests__/rollup-sync-channel-safety.test.ts`
- [x] `npm run build` clean.
- [x] No lint diagnostics on changed files.
- [x] Live CL Final preflight via service-role:
  4 events, 31 positive tiers, 0 existing 4TF `tier_channel_sales` rows,
  would insert 31 rows, tier revenue £44,920.
- [x] Applied data backfill via service-role Supabase client:
  inserted 31 rows, rows after 31, tickets 2,612, revenue £44,920.

## Deviations

- Prompt estimated ~32 rows. The live database has 31 positive
  `event_ticket_tiers` rows for `4TF26-ARSENAL-CL-FL`; the reconstructed
  revenue exactly matches the target £44,920, so 31 is the correct live
  row count.
- Supabase MCP/CLI is not available in this agent environment. The migration
  logic was applied through the service-role Supabase client with the same
  insert-only natural-key dedupe. Migration 088 is still committed so schema
  history records the operation.
