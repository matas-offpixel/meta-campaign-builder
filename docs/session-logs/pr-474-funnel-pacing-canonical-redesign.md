# PR-B: Funnel Pacing canonical redesign

## PR

- **Number:** 474
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/474
- **Branch:** `cursor/funnel-pacing-canonical-redesign`

## Summary

Single-source-of-truth wiring across the venue page's Performance tab
(`VenueStatsGrid`) and Funnel Pacing tab. The page-level computes a
canonical engagement struct ONCE from portal data, and both surfaces
render from the same lifetime cache + tier_channel_sales values via a
new pure helper. The two surfaces literally cannot disagree because
they share identical inputs into the same function — there is no
"second wiring decision".

Builds on #468 (PR-A canonical Meta clicks + LPV cache column) and
#472 (PR-A.5 R2a rollup fanout fix). Refs convergence arc #437 /
#438 / #440 / #454 / #459.

## What changed

### A) Performance Summary additions (`VenueStatsGrid`)

- New **LPV tile** in the topline grid, sourced from
  `event_code_lifetime_meta_cache.meta_landing_page_views` (migration
  099). Edinburgh: `LPV 53,758`.
- **Clicks** now reads from `meta_link_clicks` in lifetime + Meta
  scope (instead of the rollup sum aggregator) for parity with Reach.
  Aggregator path retained for non-lifetime / non-Meta scopes.
- New tooltips on both tiles flag the canonical lifetime-cache source.
- Cache-miss state on LPV mirrors the existing Reach awaiting-sync
  tooltip (audit deliverable #4 from #418).

### B) Performance Summary canonicalisation (documented)

| Metric    | Source                                                |
| --------- | ----------------------------------------------------- |
| Reach     | `event_code_lifetime_meta_cache.meta_reach`           |
| Clicks    | `event_code_lifetime_meta_cache.meta_link_clicks`     |
| LPV       | `event_code_lifetime_meta_cache.meta_landing_page_views` |
| Spend     | `SUM(event_daily_rollups.ad_spend_allocated ?? ad_spend) + ad_spend_presale` |
| Tickets   | `SUM(tier_channel_sales.tickets_sold)`                |

Documented inline in `lib/dashboard/venue-canonical-funnel.ts` file
header and at the page-level entry points
(`app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` and
`app/share/venue/[token]/page.tsx`).

### C) Funnel Pacing reads via shared selector

- New pure helper `lib/dashboard/venue-canonical-funnel.ts` exporting
  `buildVenueCanonicalFunnel(input)`. Pure, no `server-only`.
- `FunnelPacingSection` accepts an optional `venueCanonical` prop;
  when supplied, renders the new `FunnelPacingVenueView`. Client-
  region scope path (`buildClientFunnelPacing`) is untouched —
  preserved for the dashboard tabs that aggregate cross-venue.
- The venue page (internal + share) builds the canonical struct once
  from portal data and passes it to `FunnelPacingSection`. The
  Performance tab consumes the same lifetime cache row directly for
  its tiles. **Both paths terminate at the same `(client_id,
  event_code)` cache row** — drift impossible by construction.

### D) Capacity-derived targets

Derived from the rates (so changing a benchmark retargets every stage
automatically):

- Reach target = capacity / (0.14 × 0.5 × 0.05) ≈ capacity × 285.71
  - Edinburgh: 5,475 → **1,564,286** ✓
- Clicks target = capacity × 40 → Edinburgh **219,000** ✓
- LPV target = capacity × 20 → Edinburgh **109,500** ✓
- Purchases target = capacity → Edinburgh **5,475** ✓

### E) Status — conversion-rate-vs-benchmark

| Stage     | Edge          | Edinburgh    | Benchmark | Status   |
| --------- | ------------- | ------------ | --------- | -------- |
| Reach     | Reach→Click   | 14.39%       | 14%       | ON TRACK |
| Clicks    | Click→LPV     | 50.92%       | 50%       | ON TRACK |
| LPV       | LPV→Ticket    | 6.51%        | 5%        | ON TRACK |
| Purchases | — (terminal)  | 64% of cap   | —         | ON TRACK |

Purchases is the terminal stage; status defaults to ON_TRACK since
upstream conversion rates already gate the funnel-health signal. The
backward-read under-pacing flag is surfaced as a SEPARATE warning
banner so the bar status doesn't double-count.

### F) Sliding scale (forward read)

New card under the bars showing:

- Extra tickets to capacity (e.g. Edinburgh: 1,977)
- Spend needed at benchmark CPT (£4.80) → £9,490 for Edinburgh
- Spend needed at live CPT (= venue spend / purchases so far)

### G) Backward read (pacing-to-event-date)

New card with: days to event, tickets remaining, required daily pace,
14-day rolling achieved daily pace, and an under-pacing warning
banner when achieved < 80% of required.

## Source-of-truth contract

Both surfaces literally consume the same data:

```
loadVenuePortalByCode(...)
  → portal { events, lifetimeMetaByEventCode, dailyRollups, ... }

  ── Performance tab ──
  VenueFullReport
    → lifetimeMetaForVenue = portal.lifetimeMetaByEventCode.find(...)
    → VenueStatsGrid reads:
       Reach   = lifetimeMetaForVenue.meta_reach
       Clicks  = lifetimeMetaForVenue.meta_link_clicks
       LPV     = lifetimeMetaForVenue.meta_landing_page_views

  ── Funnel Pacing tab ──
  buildVenueCanonicalFunnel({
    lifetimeCacheRow: portal.lifetimeMetaByEventCode.find(...),  // SAME ROW
    ...
  })
  → FunnelPacingVenueView reads:
     Reach   = canonical.metrics.reach        (← lifetimeCacheRow.meta_reach)
     Clicks  = canonical.metrics.clicks       (← lifetimeCacheRow.meta_link_clicks)
     LPV     = canonical.metrics.landingPageViews  (← lifetimeCacheRow.meta_landing_page_views)
```

A future change to how any of these are resolved updates one location
(the cache writer or the helper) and both surfaces inherit. There is
no second wiring decision. The contract is documented inline at the
page-level entry points and in the helper's file header.

## Scope / files

New:
- `lib/dashboard/venue-canonical-funnel.ts`
- `lib/dashboard/__tests__/venue-canonical-funnel.test.ts`
- `components/dashboard/clients/funnel-pacing-venue-view.tsx`

Modified:
- `lib/dashboard/canonical-event-metrics.ts` (+ `landingPageViews` field)
- `components/share/venue-stats-grid.tsx` (LPV tile + canonical Clicks)
- `components/share/venue-full-report.tsx` (thread extended `lifetimeMeta`)
- `components/dashboard/clients/funnel-pacing-section.tsx`
  (accept `venueCanonical` prop)
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`
  (build canonical struct + pass to Funnel Pacing tab + SoT comment)
- `app/share/venue/[token]/page.tsx`
  (same SoT contract on the public surface)
- `lib/dashboard/__tests__/venue-stats-grid-lifetime-reach.test.ts`
  (updated pinned-shape assertion to include the two new fields)

Out of scope (per the user spec):

- Rollup writer / dedup logic (correct post-#472).
- Client portal mini-strip (Phase 2).
- Admin route pagination hotfix (separate small PR).
- SWG3 lifetime cache staleness (separate diagnostic).

## Verification

### Supabase MCP (production data)

```sql
-- Lifetime cache row for WC26-EDINBURGH
SELECT event_code, meta_reach, meta_link_clicks,
       meta_landing_page_views, meta_impressions
FROM event_code_lifetime_meta_cache
WHERE event_code = 'WC26-EDINBURGH';
-- → reach 733,878 · clicks 105,563 · LPV 53,758 · impressions 2,600,953 ✓

-- Capacity + tier_channel SUM
SELECT SUM(capacity) AS capacity,
       SUM(...) AS tier_channel_sum
FROM events e
WHERE e.event_code = 'WC26-EDINBURGH';
-- → capacity 5,475 · tier_channel SUM 3,498 ✓
```

### Helper tests

```bash
node --experimental-strip-types --test \
  lib/dashboard/__tests__/venue-canonical-funnel.test.ts
# 15 tests, 5 suites — all passing.
```

### Full validation

- [x] `npm run build` — green
- [x] `npm run lint` on touched files — clean (one pre-existing
  unescaped-apostrophe was the only new warning; fixed)
- [x] `npm test` — 1856 pass, 1 pre-existing fail in
  `batch-fetch-video-metadata.test.ts` (unrelated)

## Notes

- The legacy `buildClientFunnelPacing` path (`event_funnel_targets`
  table + sold-out-derived benchmarks) is unchanged. It still drives
  the cross-venue dashboard tabs. Only the venue-scope rendering is
  swapped over to the canonical view.
- The new helper is pure with no `server-only` directive so it tests
  cleanly under `--experimental-strip-types --test`.
- Benchmark CPT (£4.80) is derived from £0.12 CPC × 40 clicks/ticket,
  matching the existing `FALLBACK_FUNNEL_TARGETS.bofu_target_cpa: 4`
  within rounding. If Matas wants a different benchmark CPT, change
  `FUNNEL_BENCHMARKS.benchmarkCostPerTicket` in the helper.
