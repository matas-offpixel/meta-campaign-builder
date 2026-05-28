# Session log — rollup writer canonical clicks + LPV (PR-A of issue #467)

## PR

- **Number:** 468
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/468
- **Branch:** `cursor/rollup-writer-canonical-clicks-lpv`

## Summary

PR-A of the funnel-pacing convergence (issue #467). Canonicalises two
Meta metrics in `event_daily_rollups` + `event_code_lifetime_meta_cache`
so every downstream surface reads from a single source:

1. **Clicks swap.** Both writers (the daily fetch in `lib/insights/meta.ts`
   and the lifetime two-pass aggregator in
   `lib/insights/event-code-lifetime-two-pass.ts`) now source from Meta's
   `clicks` field ("Clicks (all)" — engagement-clicks) instead of
   `inline_link_clicks` (outbound-link only). Column name `link_clicks`
   was kept to avoid touching ~80 downstream readers in one commit; a
   rename can land in a follow-up if the touchpoint count is ever
   worth it. CPC + CTR re-baseline accordingly — pre-PR was
   outbound-link basis, post-PR is engagement basis.

2. **LPV addition.** New `landing_page_views` column on
   `event_daily_rollups` and new `meta_landing_page_views` on
   `event_code_lifetime_meta_cache` (migration 099). Resolver extracted
   from `lib/reporting/active-creatives-fetch.ts:296-300` into a shared
   `lib/insights/lpv-priority-chain.ts` so per-creative LPV (active
   creatives panel) and per-event-day LPV (rollups) stay numerically
   consistent. Priority chain: `omni_landing_page_view` →
   `offsite_conversion.fb_pixel_landing_page_view` → `landing_page_view`.

3. **Backfill route.**
   `app/api/admin/rollup-canonical-clicks-lpv-backfill/route.ts` — POST,
   `CRON_SECRET` bearer, concurrency 3, default 180-day window,
   idempotent. Run via Vercel MCP after deploy lands; rewrites both
   tables with the new metric definitions for every active event_code.

PR-B (the funnel-pacing surface rebuild) lands on top after this
merges; this PR is purely data-layer (no UI changes beyond the
daily-tracker column re-label + CPC tooltip).

## Pre-implementation verification (Meta MCP, Edinburgh week 2026-05-21 → 2026-05-27)

|                                  | `[WC26-EDINBURGH] TRAFFIC` | `[WC26-EDINBURGH] CONVERSION` |
| -------------------------------- | -------------------------- | ----------------------------- |
| `clicks` (top-level, "all")      | **6,510**                  | **286**                       |
| `actions[link_click]` = inline   | 5,518                      | 145                           |
| Δ (engagement over inline)       | +992 (+18%)                | +141 (+97%)                   |
| `actions[landing_page_view]`     | 4,375                      | 119                           |
| `actions[omni_landing_page_view]`| 4,375                      | 119                           |
| LPV priority chain resolves to   | omni (= raw)               | omni (= raw)                  |

Confirms both design assumptions:

- `clicks` ≥ `inline_link_clicks` always; the delta is meaningful
  (engagement-heavy campaigns can ~2× the outbound count).
- `landing_page_view` action_type is present + populated on every Meta
  row that produces an LPV; `omni_landing_page_view` is also present
  and equals the raw value (so the priority chain doesn't
  double-count when both fire).

## Scope / files

### New

- `supabase/migrations/099_event_rollups_canonical_clicks_lpv.sql` —
  adds `landing_page_views` to `event_daily_rollups` +
  `meta_landing_page_views` to `event_code_lifetime_meta_cache`.
- `lib/insights/lpv-priority-chain.ts` — shared LPV resolver (export
  `LPV_ACTION_PRIORITY` + `resolveLpvFromActions`).
- `lib/insights/__tests__/lpv-priority-chain.test.ts` — 9 unit tests,
  including the omni-vs-raw double-count regression guard.
- `app/api/admin/rollup-canonical-clicks-lpv-backfill/route.ts` —
  one-time historical backfill admin route.

### Modified (writer + reader plumbing)

- `lib/insights/meta.ts` — daily fetch + today snapshot + lifetime
  Pass-1: swap `inline_link_clicks` → `clicks`, add LPV resolution +
  return-shape field. Affects 5 distinct `params.fields` strings
  inside the file.
- `lib/insights/event-code-lifetime-two-pass.ts` — same swap on the
  Pass-1 aggregator row type + accumulator; adds `landingPageViews`
  to `Pass1Totals`.
- `lib/insights/types.ts` — adds `landingPageViews` to
  `DailyMetaMetricsRow`; tightens docstrings on `linkClicks` and
  the lifetime totals shape to reflect the new basis.
- `lib/dashboard/rollup-sync-runner.ts` — threads LPV through the
  daily upsert + today-snapshot fallback + zero-pad path; lifetime
  cache upsert now includes `meta_landing_page_views`.
- `lib/db/event-daily-rollups.ts` — adds `landing_page_views` to
  `EventDailyRollup` + `MetaUpsertRow`; expands the SELECT +
  no-op-guard match list.
- `lib/db/event-code-lifetime-meta-cache.ts` — adds
  `meta_landing_page_views` to the row type, upsert payload,
  SELECT, and `normaliseRow`.
- `lib/db/client-portal-server.ts` — adds `landing_page_views`
  (optional, mirrors the awareness-column precedent) to
  `DailyRollupRow`.

### Modified (existing backfill / admin routes carry the new field)

- `app/api/admin/event-rollup-backfill/route.ts` — `zeroPadMetaRows`
  threads LPV through both branches.
- `app/api/admin/backfill-meta-purchase-split/route.ts` —
  `MetaUpsertRow` literal now includes LPV.
- `app/api/admin/event-code-lifetime-meta-backfill/route.ts` —
  upserts the new `meta_landing_page_views` column too.

### Modified (UI)

- `components/dashboard/events/daily-tracker.tsx` — relabels the
  "Link clicks" column to "Clicks" + "CPL" to "CPC"; adds tooltips
  on both column headers explaining the post-PR basis. File-header
  docstring updated to match.

### Modified (consumers that needed type narrowing or fixture updates)

- `lib/reporting/active-creatives-fetch.ts` — re-aliases
  `ORPHAN_LPV_PRIORITY` to the shared `LPV_ACTION_PRIORITY` so the
  active-creatives panel and the rollup writer can never drift.
- `lib/reporting/funnel-pacing.ts` — adds `meta_landing_page_views`
  to the inline cache-row structural type so the helper signature
  stays compatible with `EventCodeLifetimeMetaCacheRow`.
- `lib/insights/__tests__/fetchEventLifetimeMetaMetrics.test.ts` —
  swaps `inline_link_clicks` → `clicks` in the mocked payload; adds
  LPV omni-vs-pixel priority assertion.
- `lib/dashboard/__tests__/canonical-event-metrics{,-pinned,-attribution,-real-attribution}.test.ts` +
  `lib/insights/__tests__/decorate-canonical-lifetime-reach.test.ts`
  — add `meta_landing_page_views` to cache-row fixtures.

### Explicitly out of scope

- `lib/insights/meta.ts:3108-3213` (`fetchVenueDailyAdMetricsForBracket`)
  still reads `inline_link_clicks`. This is the venue-spend allocator's
  ad-level helper, not a rollup or lifetime-cache writer. The
  implement prompt scoped this PR to "both writers"; the allocator's
  internal click accounting can swap in a follow-up if needed.
- `link_clicks` column rename to `clicks_all`. Would force-update ~80
  downstream readers in one commit. Doing it incrementally instead.
- Funnel-pacing surface itself. PR-B's scope.
- `active_creatives_snapshots.payload` LPV (per-creative breakdown).
  Stays as the per-creative source.

## Validation

- [x] `npm test` — 819 tests pass across `lib/insights/**`,
  `lib/dashboard/**`, `lib/db/**`, `lib/reporting/**` (the directories
  this PR touches). One pre-existing failure in
  `lib/audiences/__tests__/batch-fetch-video-metadata.test.ts` —
  unrelated to this PR; flagged for separate triage.
- [x] `npm run lint -- <files I touched>` — clean (0 errors / 0
  warnings on the changed paths). The full-sweep `npm run lint` has
  91 pre-existing problems in unrelated files (`useMeta.ts`,
  `interest-suggestions.ts`, etc.) that pre-date this PR.
- [x] `npx tsc --noEmit` — type-clean on every file this PR touched.
  Pre-existing TS errors remain in `lib/audiences/__tests__/bulk-website.test.ts`,
  `lib/meta/__tests__/audience-idempotency.test.ts`,
  `lib/dashboard/__tests__/funnel-aggregations.test.ts`, and
  `lib/db/__tests__/client-dashboard-aggregations.test.ts` — all in
  files this PR does not modify.
- [ ] `npm run build` — not run locally (Next.js 16 build is heavy);
  Vercel preview deploy will exercise it.

## Post-merge runbook

1. Vercel deploy applies migration 099 automatically (Supabase migration
   pipeline). Confirm via Vercel deploy logs.
2. Run the backfill once via Vercel MCP:

   ```bash
   curl -sS -X POST \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"days_back": 180}' \
     https://<vercel-prod-url>/api/admin/rollup-canonical-clicks-lpv-backfill
   ```

3. Re-query Edinburgh via Meta MCP for one recent day post-deploy;
   confirm `event_daily_rollups.link_clicks` now matches the
   `clicks` (all) value reported by Meta for the same window.
4. Spot-check the daily-tracker UI in the dashboard — column header
   should read "Clicks" + "CPC" with the tooltips. CPC value on
   high-engagement campaigns will visibly drop (engagement basis vs
   outbound basis).

## Notes / follow-ups

- **CPC / CTR re-baseline.** Historical reports exported pre-merge
  retain the outbound-link basis (and that snapshot is correct for the
  date they were captured). The dashboard surfaces re-baseline to
  engagement basis from the merge date forward.
- **Column rename.** `link_clicks` → `clicks_all` would be ~80 files;
  not done here. Worth a follow-up once PR-B lands.
- **Funnel-pacing rebuild (PR-B).** Now unblocked: the surface can
  read LPV from `event_daily_rollups.landing_page_views` directly
  instead of summing from `active_creatives_snapshots.payload`, and
  clicks from `event_daily_rollups.link_clicks` will match the
  per-creative view at the engagement-clicks basis.
- **Allocator click basis.** `fetchVenueDailyAdMetricsForBracket`
  still uses `inline_link_clicks` for its internal pro-rata math —
  flagged in "Explicitly out of scope" above; worth a quick audit
  whether to swap it for consistency before PR-B reads the new
  LPV column.
