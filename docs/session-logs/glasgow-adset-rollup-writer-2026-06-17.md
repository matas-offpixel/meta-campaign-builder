# Session log — Glasgow live ad-set rollup writer (write-time split)

**Branch:** `cc/glasgow-adset-rollup-writer` (Claude Code, worktree off `main` @ f03c83d)
**Dates:** 2026-06-17 → 2026-06-18
**Stage A diagnosis:** `docs/glasgow-adset-rollup-writer-2026-06-17.md` (read that first)

## What this PR does

Replaces the hard-coded read-time snapshot in `lib/dashboard/event-code-adset-splits.ts`
(deleted) with a **live ad-set-level Meta pull** that writes correctly-attributed spend +
engagement to `event_daily_rollups` AND the lifetime cache for the two Glasgow venue codes
(`WC26-GLASGOW-O2`, `WC26-GLASGOW-SWG3`) only. After this, the dashboard tracks Meta truth
automatically — no manual quarterly snapshot refreshes.

Root cause (verified, Stage A): the mixed-ad-set campaign 6925933901665
(`[WC26-GLASGOW-O2] TRAFFIC`, 5 O2 + 4 SWG3 ad sets) has an `[WC26-GLASGOW-O2]` bracket, so the
campaign-level bracket matcher landed its **entire** spend + engagement on O2. The old fix patched
this at read-time (spend via `getSpendAdjustmentGbp` on 4 surfaces; engagement via
`applyAdsetSplitsToLifetimeMeta` on the lifetime cache) using a snapshot frozen at 2026-06-03
(£7,784 / 78.53%-O2). The snapshot drifted ~£70–100/day; by 2026-06-17 O2 read ~£3,187 over.

## Approach (write-time, 3 fetch paths)

Campaign 6925933901665 is **excluded** from the campaign-level bracket match in all three Meta
fetch paths, and its per-venue share is **re-added at ad-set level**:

1. `fetchEventDailyMetaMetrics` (daily rollups) — `excludeCampaignIds` skips it; runner merges the
   venue's ad-set daily rows into `metaByDate` before engagement-owner gating.
2. `fetchEventTodayMetaSnapshot` (today's live row) — same exclusion, so today stays consistent.
3. `fetchEventLifetimeMetaMetrics` two-pass (lifetime cache) — same exclusion via
   `aggregatePass1Pages(excludeCampaignIds)` (drops it from the additive sums AND the Pass-2
   reach-dedup ID set); runner re-adds the venue's ad-set **engagement** totals (D1-a).

The umbrella mechanism (`lib/dashboard/wc26-glasgow-umbrella.ts`, suffix-less `[WC26-GLASGOW]`
campaigns split by cutover date) is **orthogonal** — 6925933901665 carries the `-O2` suffix so the
umbrella loop never touched it; left unchanged.

### Engagement-owner gating
The merged Glasgow rows flow through the existing PR #499 `ownedOrNull` gating
(`rollup-sync-runner.ts`) — `ad_spend` stays per-fixture, presale + engagement are owner-only.

## Files

| File | Change |
|---|---|
| `lib/dashboard/glasgow-adset-rollup-fetch.ts` | **NEW.** Classifier + per-day/lifetime aggregators + `fetchGlasgowAdSetSplits` / `fetchGlasgowAdSetLifetimeSplits` + `isGlasgowSplitEventCode`. Pure logic is `@/`-free; production wrappers lazy-import the Graph client (test-runner alias rule). Throws on Meta error (no fallback) + unknown ad-set name. |
| `lib/dashboard/__tests__/glasgow-adset-rollup-fetch.test.ts` | **NEW.** 15 tests — 9-ad-set O2(5)/SWG3(4) split, per-day/venue aggregation, engagement sums, fail-loud (Meta error + unknown name + missing date), pagination, lifetime totals. |
| `lib/insights/event-code-lifetime-two-pass.ts` | `aggregatePass1Pages` gains optional `excludeCampaignIds` (default `[]` → byte-identical for non-Glasgow; PR #418 dedup preserved). |
| `lib/insights/meta.ts` | `excludeCampaignIds` on the 3 fetch args + `campaign_id` added to the daily/today field lists + skip in the primary loops + threaded into Pass-1. |
| `lib/dashboard/rollup-sync-runner.ts` | Meta leg: exclude + merge venue ad-set rows. Lifetime leg (D1-a): exclude + re-add venue ad-set engagement before cache upsert. |
| `lib/db/client-portal-server.ts` | Removed `applyAdsetSplitsToLifetimeMeta` import + call. |
| `components/share/client-portal-venue-table.tsx` | Removed `getSpendAdjustmentGbp` import + the read-time spend adjustment. |
| `app/share/venue/[token]/page.tsx`, `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` | Removed `getSpendAdjustmentGbp` import + `spendAdjustmentGbp` arg. |
| `lib/dashboard/venue-canonical-funnel.ts` | `spendAdjustmentGbp` param kept as a 0-default no-op seam; stale doc comments updated. |
| `lib/dashboard/event-code-adset-splits.ts` + test | **DELETED.** |

## Premise corrections vs the PR prompt (surfaced & approved in Stage A)

1. `getSpendAdjustmentGbp` had **4** call sites, not the 2–3 listed (the two `page.tsx` files were
   missing). All removed.
2. The lifetime cache has **no spend column** — it over-attributed *engagement*, not spend.
3. Pre-existing **umbrella** write-time machinery existed in all 3 fetch paths (prompt omitted it).
   The "exclude in the runner" plan was not implementable (the fetch aggregates per-day) → exclusion
   moved inside the fetches via `excludeCampaignIds` (Matas approved D4-a, D5-a).
4. **Deviation from prompt API:** `GlasgowAdSetSplit` returns `days: DailyMetaMetricsRow[]` (not
   `rows: MetaUpsertRow[]`). The merge point is *before* engagement-owner gating, so the natural
   unit is the pre-gating per-day metric shape, which `DailyMetaMetricsRow` already is. `MetaUpsertRow`
   would force premature owner-gating.

## Known approximation (D1-a)

Lifetime-cache **reach** is account-deduplicated (Pass-2); ad-set reaches overlap and can't be
summed exactly. The re-added venue reach is therefore approximate — **no worse than the deleted
snapshot's `sharePercent × frozen reach`**, and now live. All other lifetime engagement metrics
(impressions, clicks, LPV, regs, video, engagements) are **exact** after the re-add — an improvement
over the old snapshot, which only split reach/clicks/LPV and left impressions/video/engagements
fully on O2.

## Verification

- `npm test`: **2400 tests, 2395 pass, 3 fail.** The 3 failures
  (`lib/audiences/__tests__/batch-fetch-video-metadata.test.ts`,
  `lib/clients/asset-queue/__tests__/copy-generator.test.ts`,
  `lib/clients/asset-queue/__tests__/sheet-parse.test.ts`) are **pre-existing and unrelated**
  (audiences / asset-queue; brittle source-snapshot + jest-style tests). Zero failures in any
  touched area; the 15 new tests pass and the PR #418 two-pass tests pass unchanged.
- `tsc --noEmit`: **zero errors in any touched file** (project baseline of 362 errors is pre-existing
  `@types/jest`-missing test files, untouched).
- `eslint` on new files: clean (exit 0). The `set-state-in-effect` errors flagged in
  `client-portal-venue-table.tsx` are at lines 2608/2643 (present on `origin/main`) — pre-existing,
  outside my edit (~1757).

## Backfill — DEFERRED (production data mutation; awaiting Matas go-ahead)

After merge, run a one-shot 365-day backfill for both Glasgow codes, then the venue allocator.
**Not executed in this session** — it mutates production rollups + calls Meta; needs explicit
sign-off and a working Meta token. Documented for the operator:

```bash
# Per the existing admin backfill route (CRON_SECRET-guarded). Confirm the exact
# route signature before running — repo has POST /api/admin/event-rollup-backfill
# (see docs/session-logs/pr-pending-creator-rollup-sync-presale-and-relaunch-coverage.md).
curl -X POST "$BASE_URL/api/admin/event-rollup-backfill?force=true" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"eventCodes":["WC26-GLASGOW-O2","WC26-GLASGOW-SWG3"],"rollupWindowDays":365}'
# (If the route does not accept eventCodes/rollupWindowDays params, run runRollupSyncForEvent
#  for the two Glasgow event_ids with rollupWindowDays:365 via a one-shot script instead.)
```

Then re-run the venue-spend allocator for the two codes to redistribute across fixtures.

### Verification SQL (run post-backfill; paste results in PR body)

```sql
SELECT e.event_code,
       ROUND(SUM(r.ad_spend_allocated + COALESCE(r.ad_spend_presale, 0))::numeric, 2) AS effective
FROM events e
LEFT JOIN event_daily_rollups r ON r.event_id = e.id
WHERE e.client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'
  AND e.event_code IN ('WC26-GLASGOW-O2', 'WC26-GLASGOW-SWG3')
GROUP BY e.event_code;
-- Expected (higher than the 2026-06-08 baseline due to ongoing spend):
--   O2  ≈ £8,000–£9,000 (±£200 of live Meta truth)
--   SWG3 ≈ £3,000–£3,200 (±£200 of live Meta truth)
```

## Blockers / follow-ups

- **Meta MCP `ads_get_ad_entities` is down** in this environment (`OTID is a required input` on every
  call; `ads_get_ad_accounts` works). The live at-PR-time ad-set truth could NOT be pulled — re-pull
  at PR review to fill in exact expected numbers.
- **Rebase before PR:** `origin/main` advanced during the session (mailchimp/tiktok PRs merged). My
  core files (`meta.ts`, `rollup-sync-runner.ts`) show only my additions in the diff, so conflict
  risk is low, but rebase onto latest `main` before opening the PR.
- **Cursor collision watch:** active `cursor/` worktrees touch the rollup writer
  (`cursor-rollup-engagement-fanout-r2a`, `cursor-rollup-fanout-audit`). Matas confirmed they were
  not mid-edit on `rollup-sync-runner.ts` when Stage B started; re-confirm before merge.
- **`spendAdjustmentGbp` no-op seam** left in `venue-canonical-funnel.ts` (default 0, no caller).
  Safe to delete in a later cleanup once confirmed unused.
