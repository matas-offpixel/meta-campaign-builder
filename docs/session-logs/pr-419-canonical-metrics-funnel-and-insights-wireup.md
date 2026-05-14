# Session log — canonical-metrics-funnel-and-insights-wireup

## PR

- **Number:** 419
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/419
- **Branch:** `cursor/creator/canonical-metrics-funnel-and-insights-wireup`

## Summary

Closes Cat F end-to-end. PR #418 fixed Stats Grid but two other
dashboard surfaces still over-counted Manchester reach: Funnel Pacing
(+507%, client-wide cache leaked into venue scope) and Creative
Insights (+15.9%, per-campaign reach sum still rendering). This PR
routes both surfaces through the canonical lifetime cache, mirrors the
PR #418 Stats Grid hard-fail-on-cache-miss UX, and adds pinned
regression tests for Manchester / Brighton / Kentish / Shepherds at
~805k Meta-UI reach.

## Scope / files

### Bug 1 — Funnel Pacing scope leak

- `lib/reporting/funnel-pacing.ts:aggregateRollupsWithCanonical` —
  filters `cacheRows` to event_codes present in `eventsByCode` (the
  same canonical scope set the helper already builds) BEFORE invoking
  `computeCanonicalEventMetricsByEventCode`. Surgical 5-line caller-
  side fix; helper contract unchanged so PR #418's pinned tests for
  partial-coverage signal still pass.

### Bug 2 — Creative Insights per-campaign sum

- New: `lib/insights/decorate-canonical-lifetime-reach.ts` (server-only
  loader) + `lib/insights/decorate-canonical-lifetime-reach-pure.ts`
  (pure compute). Mirrors PR #418's pure-vs-loader split so the unit
  tests run under `node --experimental-strip-types` without tripping
  `@/` aliases or the `server-only` guard.
- `app/api/share/venue/[token]/insights/route.ts` and
  `app/api/insights/venue/[clientId]/[event_code]/route.ts` now call
  `decorateWithCanonicalLifetimeReach` after `fetchEventInsights`.
  For lifetime preset (`maximum` + no custom range), the decorator
  reads `event_code_lifetime_meta_cache` and surfaces the deduped
  reach via `totals.reach`. Cache miss propagates as `null` with
  `reachSource = "lifetime_cache_miss"`.
- `lib/insights/types.ts:MetaTotals` extended with optional
  `reach?: number | null` and `reachSource?: ...` fields. Backwards-
  compatible — surfaces that don't decorate keep rendering `reachSum`.
- `components/report/meta-insights-sections.tsx` extracts a `ReachCell`
  helper that renders:
  - cache hit  → "Reach" (deduped) with explanatory tooltip,
    `data-testid="venue-insights-reach-value"`.
  - cache miss → "—" with the audit-mandated tooltip "Awaiting Meta
    sync. Data refreshes every 6h via cron.",
    `data-testid="venue-insights-reach-cache-miss"`.
  - non-lifetime / undefined → "Reach (sum)" (existing pre-PR
    behaviour preserved).
- `Metric` accepts optional `title` + `data-testid` props.

### Tests

- `lib/dashboard/__tests__/canonical-event-metrics.test.ts` — added
  the "scope contract (PR #419)" describe block. Two cases:
  1. REGRESSION pin of the +507% bug shape (caller leaks → helper
     unions all cache codes).
  2. Positive contract — caller filters first → helper output equals
     scope.
- `lib/dashboard/__tests__/canonical-event-metrics-pinned.test.ts` —
  added "Manchester funnel-pacing pin" + "Manchester Creative Insights
  pin" describe blocks. Covers:
  - Manchester scoped pacing reach within ±2% of 805,264 even with
    client-wide cache rows in the input.
  - `funnel-pacing.ts` source-string assertions for the in-scope
    filter.
  - Both venue insights routes call `decorateWithCanonicalLifetimeReach`.
  - `meta-insights-sections.tsx` branches on `reachSource` and uses
    the audit tooltip + `data-testid` for cache hit/miss cells.
- New: `lib/insights/__tests__/decorate-canonical-lifetime-reach.test.ts`
  — exercises the pure decorator over the full decision matrix:
  cache hit → 805,473, cache miss → null + miss source, NULL
  meta_reach → miss, non-lifetime → undefined + non-lifetime source,
  error result passthrough.

## Validation

- [x] `npm run build` — clean.
- [x] `npm test` — **1184 pass / 1 fail / 2 skipped (1187 total)**.
  Sole failure is the pre-existing `fetchAudienceMultiCampaignVideos
  call-count budget` source-string assertion (verified against `main`
  in PR #418's run).
- [ ] Local smoke: hit
  `/api/share/venue/<manchester-token>/insights?datePreset=maximum`
  and confirm response carries `totals.reach=805_473` +
  `totals.reachSource="lifetime_cache_hit"`. Pending after backfill.
- [ ] Post-merge spot-check on Manchester venue page: Stats Grid +
  Funnel Pacing TOFU + Creative Insights reach should all align to
  ~805k within ±2% Meta API jitter.

## Notes

- `fetchEventInsights` is unchanged on purpose — its per-campaign
  breakdown rows and `totals.reachSum` are still legitimately
  consumed by `/share/report/[token]`, `/api/overview/stats`, and
  the per-event insights routes (which can't dedup across an
  arbitrary set of campaigns without a cached account-level row
  anyway).
- The pure helper (`applyCanonicalLifetimeReach`) takes
  `isLifetimeScope: boolean` rather than the full `DatePreset` /
  `CustomDateRange` pair so it stays insulated from
  `lib/insights/types.ts` shape drift. Loader computes the flag.
- Manchester pin in the new tests uses `805_473` (Meta UI screenshot
  in Joe's brief), tolerance ±2%. PR #418's pin used `805_264`
  (PR #417 Cat F comment). Both are within tolerance — the brief's
  fresher figure is the canonical post-fix target.
