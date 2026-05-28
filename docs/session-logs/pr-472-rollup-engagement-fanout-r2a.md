# Session log

## PR

- **Number:** 472
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/472
- **Branch:** `cursor/rollup-engagement-fanout-r2a`

## Summary

PR-A.5 (issue #471). Fixes the per-fixture engagement fanout in
`event_daily_rollups`: every fixture sharing an `event_code` was
storing the IDENTICAL Meta engagement + attribution number on its
own row, so any reader that `SUM`-aggregated across siblings was
triple-counting (Edinburgh 316,689 clicks lifetime vs Meta's 105,563
— exactly ×3 for a 3-fixture venue).

R2a fix per the issue #471 audit:

1. **Writer:** one sibling per `event_code` (lex-min `events.id`)
   becomes the "engagement owner" and writes the campaign-level Meta
   columns. The other siblings write `NULL` on those columns. Spend
   stays per-fixture (allocator does its job), tickets stay per-
   fixture (sourced from `tier_channel_sales`).
2. **Reader:** `splitEventCodeLpvByClickShare` falls back to equal-
   split when the rollup click signal collapses to a single non-zero
   sibling (matches the "spend stays split equally" decision locked
   in #471).
3. **Backfill:** one-shot admin route reshapes existing rows via SQL
   only (no Meta API calls — option (iii) from the audit). 2,144
   identical-fanout day-rows trivially NULLed; ~45 race-jitter days
   resolved via a MAX-impressions tie-break.

## Scope / files

- `lib/db/event-code-primary-sibling.ts` — new owner resolution helper
- `lib/db/event-daily-rollups.ts` — `MetaUpsertRow` types + upsert payload tolerate explicit `null`
- `lib/dashboard/rollup-sync-runner.ts` — ownership check + `ownedOrNull` projection
- `lib/reporting/funnel-pacing-payload.ts` — equal-split fallback when click weights collapse
- `lib/dashboard/benchmark-alert-engine.ts` — skip rows with `meta_regs IS NULL` so non-owner siblings don't fire false-positive stalled alerts
- `app/api/admin/rollup-engagement-fanout-collapse/route.ts` — one-shot historical backfill (Bearer `CRON_SECRET`)
- `lib/auth/public-routes.ts` — proxy carve-out for the new admin route (PR #470 lesson)
- `lib/db/__tests__/event-code-primary-sibling.test.ts` — Edinburgh (3-fixture) + Brighton (4-fixture) shape pins + fail-OPEN paths
- `lib/reporting/__tests__/funnel-pacing.test.ts` — degenerate-split fallback pinned for both shapes; proportional path preserved on allocator-output Manchester shape

## Validation

- [x] `node --experimental-strip-types --test lib/db/__tests__/event-code-primary-sibling.test.ts lib/reporting/__tests__/funnel-pacing.test.ts lib/dashboard/__tests__/rollup-sync-runner.test.ts lib/db/__tests__/event-code-lifetime-meta-cache.test.ts lib/db/__tests__/upsert-noop-guard.test.ts lib/dashboard/__tests__/venue-rollup-dedup.test.ts` — **62 tests pass, 0 fail**
- [x] `npm run build` — clean
- [x] `npx eslint` on touched files — 0 errors, 0 warnings
- [x] `npx tsc --noEmit` — 0 new errors on touched files; pre-existing test-file errors unrelated
- [ ] Post-deploy: hit `/api/admin/rollup-engagement-fanout-collapse` with `dry_run=true` on Edinburgh; then prod backfill; then verify Supabase rollups vs lifetime cache vs Meta MCP

## Notes

- The pre-existing read-time helper `dedupVenueRollupsByEventCode`
  (`lib/dashboard/venue-rollup-dedup.ts`) continues to run on every
  venue-scope read. Post-R2a it's a no-op (MAX of one non-null + N
  nulls = the non-null), but leaving it in place is a defensive
  belt-and-braces against future writer regressions. Zero readers
  touched at venue scope.
- The funnel-pacing surface read (`lib/reporting/funnel-pacing.ts`)
  self-fixes — its raw `SUM(link_clicks)` now collapses to the
  single non-null value = the event-code total. This was the entire
  Edinburgh 316k bug.
- Failure mode: `isEngagementOwnerForCode` fails OPEN (treats event
  as owner) so a transient DB blip preserves pre-PR-A.5 behaviour
  (write the values) instead of blanking engagement across an entire
  sync window. The next successful sync reconciles, and the venue-
  rollup dedup helper remains as a read-time backstop in the
  meantime.
