# Session log — BM Asset Sync: fix scan timeout on large BMs

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cc/ops/bm-scan-timeout-fix`

## Summary

`POST /api/business-managers/[bizId]/scan` ("Sync now") hit Vercel's 120s
`maxDuration` on large BMs — verified live on Columbo Group
(527693220707294, ~1060 pages): a 504 Runtime Timeout, even though the scan
had already written 1060 rows to `bm_pages` and 700+ `detected_new` events.
Because `client_business_managers.last_scanned_at` / `last_error` were only
updated after the *entire* scan completed, the UI showed no progress at all
despite the real work having succeeded.

## Root cause

Not the Meta API fetch — `scanBusinessManager` logged one
`bm_page_access_events` row per newly-detected page with a **sequential
awaited single-row insert** (`logAccessEvent` in a `for` loop). 700+ of
those round trips was the actual time sink pushing past 120s.
`missing_access_count` (shown in the dashboard) was never actually at risk
of going stale — it's computed LIVE from `bm_pages` in
`listBusinessManagerSummaries`, and `bm_pages` itself is written in ONE
bulk upsert *before* the slow per-page event loop — so it was already
correct even mid-timeout. The staleness was specifically
`last_scanned_at` / `last_error`.

## Scope / files

- `app/api/business-managers/[bizId]/scan/route.ts` — `maxDuration` 120 →
  800 (Vercel Pro ceiling, same precedent as `grant-all/route.ts` and
  numerous cron/backfill routes — confirmed via `grep -rn maxDuration app`).
- `app/api/cron/bm-page-scan/route.ts` — `maxDuration` 300 → 800. Same
  `scanBusinessManager` helper, called sequentially across every connected
  BM; a single ~1000+ page BM alone could approach the old 300s budget.
- `lib/db/business-managers.ts` — new `logAccessEventsBulk` (one
  `.insert()` call for N rows) alongside the existing single-row
  `logAccessEvent` (kept — still used for the two early-return
  `sync_error` events).
- `lib/bm/chunk.ts` (new) — pure, dependency-free `chunk<T>(items, size)`.
  Split out from `sync.ts` (which imports `client.ts`'s strip-mode-
  incompatible `MetaApiError` class and the `server-only` package) so the
  chunking invariant is directly unit-testable — same rationale as the
  three prior grant-fix PRs' pure-module splits.
- `lib/bm/sync.ts` — `scanBusinessManager` refactored:
  1. `bm_pages` upsert (unchanged) — checkpoint `last_scanned_at`
     immediately after, before the slow phase starts.
  2. Detected-new event logging now chunks `newPageIds` into groups of 100
     (`DETECTED_NEW_CHECKPOINT_BOUNDARY`), bulk-inserts each chunk with
     `logAccessEventsBulk`, and checkpoints `last_scanned_at` after every
     chunk. A mid-loop timeout now leaves `last_scanned_at` at the most
     recent completed 100-page boundary instead of the scan's start.
  3. The chunk loop is wrapped in try/catch — an unexpected exception
     records `last_error` and lets the scan still return `ok: true` with
     accurate `missingAccess` (the audit trail of *which* pages were new
     this run may be incomplete, but `bm_pages`/access flags are already
     correct). Note: this does NOT catch a true platform-level 504 kill
     (Vercel terminates the process; nothing in-process can run at that
     point) — the real mitigation for that is the per-chunk checkpointing
     above, which now runs well within the new 800s budget for any
     realistic BM size.
  4. Final `missingAccess` computation + checkpoint unchanged.
- `lib/bm/__tests__/chunk.test.ts` (new) — 6 tests: empty input, uneven
  remainder, full-order/no-duplicate preservation at Columbo-Group scale
  (~1060 items), exact-boundary input, sub-boundary input, invalid size.

**No migration added.** `missing_access_count` has no persisted column on
`client_business_managers` — it's always computed live from `bm_pages`, so
there's no "summary row" to separately recompute/store. Confirmed by
reading `lib/db/business-managers.ts` and migration 145's schema.

## Validation

- [x] `npm run build` — exit 0.
- [x] `npm test` — 3030 tests (+6 new), 3013 pass (+6), same 14
      pre-existing unrelated failures as `main` — no new failures.
- [x] `npx eslint` on touched files — clean.
- [ ] Manual smoke test — Matas to "Sync now" on Columbo Group post-deploy;
      expect completion under 800s with `last_scanned_at` updated and
      `last_error` cleared.

## Notes

- Full integration testing of `scanBusinessManager`'s checkpointing
  behavior (mocking Supabase + Meta calls end-to-end) was not attempted —
  the module's own top-level imports (`@/lib/meta/client`, `server-only`)
  are incompatible with this repo's `--experimental-strip-types` test
  runner, consistent with every other `lib/meta/business-manager.ts`-
  adjacent module this week. The pure `chunk()` extraction gives direct
  coverage of the one algorithmic piece that determines checkpoint
  correctness; the DB/Meta-call orchestration around it is unchanged in
  shape from the pre-existing (already-relied-upon) early-return paths.
