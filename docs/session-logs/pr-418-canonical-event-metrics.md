# Session log — canonical-event-metrics

## PR

- **Number:** 418
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/418
- **Branch:** `cursor/creator/canonical-event-metrics`

## Summary

Ships the architectural fix for the dashboard reconciliation crisis flagged
by PR #417's audit. Introduces `getCanonicalEventMetrics` as the single
event-code-keyed entry point used by every venue surface, and rewires
`fetchEventLifetimeMetaMetrics` to use Meta's two-pass `level=campaign` →
`level=account` design so reach is dedup'd across sibling campaigns
(Cat F fix). Stats Grid hard-fails on a lifetime cache miss instead of
falling back to summed-daily-reach.

## Scope / files

### New modules

- `lib/insights/event-code-lifetime-two-pass.ts` — pure aggregation +
  filter helpers extracted from `meta.ts` so the Cat F regression suite can
  exercise them under `node --experimental-strip-types --test` without
  tripping `@/` aliases or `server-only`.
- `lib/dashboard/canonical-event-metrics.ts` — pure compute layer
  (`computeCanonicalEventMetrics`, `computeCanonicalEventMetricsByEventCode`,
  `sumCanonicalEventMetrics`).
- `lib/dashboard/canonical-event-metrics-loader.ts` — Supabase-backed
  wrappers (`loadCanonicalEventMetrics`, …) that `server-only` flags so the
  pure layer stays testable.

### Updated surfaces

- `lib/insights/meta.ts` — Pass 1 (`level=campaign`) collects the matched
  campaign IDs and per-campaign additive metrics; Pass 2
  (`level=account`, `filtering=campaign.id IN [...]`) returns the
  cross-campaign deduped reach + frequency. Falls back to the Pass-1
  `max(per_campaign_reach)` when Pass 2 returns no row, with a `console.warn`
  diagnostic.
- `components/share/venue-stats-grid.tsx` — when in lifetime Meta scope and
  the cache row is missing, the Reach cell renders `—` with the tooltip
  "Awaiting Meta sync. Data refreshes every 6h via cron." (audit
  recommendation #3).
- `lib/reporting/funnel-pacing.ts` — `aggregateRollups` now groups by
  `event_code`, loads `event_code_lifetime_meta_cache` rows, and routes
  through `computeCanonicalEventMetricsByEventCode` +
  `sumCanonicalEventMetrics`. PR #413's `dedupVenueRollupsByEventCode` and
  PR #410's `splitEventCodeLpvByClickShare` are preserved and exercised by
  the canonical helper.
- `lib/reporting/creative-patterns-cross-event.ts` — `(event_code, ad_id)`
  dedup pre-pass on creative-snapshot ingestion (Cat A fix), with a
  `dedupedConceptDuplicates` diagnostic counter.

### Tests added

- `lib/insights/__tests__/fetchEventLifetimeMetaMetrics.test.ts` — Cat F
  regression: mocked Meta API responses with overlapping campaign reaches,
  asserts that the result is account-level deduped (805,264) and **not** the
  per-campaign sum (932,982). Also covers filter construction, additive
  metrics, and Pass-2 fallback. (11/11 pass.)
- `lib/dashboard/__tests__/canonical-event-metrics.test.ts` — pure compute
  unit tests covering cache hit/miss, Cat A dedup, spend resolution,
  windowed metrics, multi-event aggregation. (18/18 pass.)
- `lib/dashboard/__tests__/canonical-event-metrics-pinned.test.ts` —
  production-pinned acceptance tests with Manchester (805,264),
  Brighton (175,000), Kentish Town (331,552), Shepherd's Bush (175,330)
  reach figures + source-string assertions verifying every wired surface
  consumes the canonical helper. (10/10 pass.)
- `lib/dashboard/__tests__/venue-stats-grid-lifetime-reach.test.ts` —
  updated to reflect hard-fail-on-cache-miss UX and the new pinned reach
  value.

### Out of scope (audit acknowledged)

- `components/share/venue-event-breakdown.tsx`,
  `components/share/client-portal-venue-table.tsx` — confirmed these
  surfaces don't render reach/impressions, so no canonical-helper wire-up
  is required (todo list items cancelled with rationale).

## Validation

- [x] `npm run build` clean (after one TS fix on the new
  `GraphPageFetcher` generic — the test seam type was double-wrapping
  `GraphPaged` and the production build caught it).
- [x] `npm test` — 1173 pass / 1 fail / 2 skipped. Sole failure is the
  pre-existing `fetchAudienceMultiCampaignVideos call-count budget`
  (verified against `main` via `git stash`).
- [ ] Local backfill smoke test for Manchester (`/api/admin/event-code-lifetime-meta-backfill`)
  — pending CRON_SECRET in `.env.local`.

## Notes

- Two-pass design lives entirely behind `fetchEventLifetimeMetaMetricsWithFetcher`
  so future callers (e.g. the cron + admin backfill) get the Cat F fix for free.
- `event_code_lifetime_meta_cache` rows produced before this PR are stale
  — the post-merge backfill (Joe's CTA) overwrites them with the deduped
  reach.
- If Pass 2 returns zero rows for a matched campaign set, we log
  `pass2_fallback_to_max=true` and surface the highest individual campaign
  reach so the UI never goes worse than the old behaviour. This is a
  deliberate guardrail, not a regression vector — production should always
  have at least one impression in the matched window.
