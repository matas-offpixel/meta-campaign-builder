# Session log — PR-C: funnel-pacing enrichment

## PR

- **Number:** pending
- **URL:** (to be filled after `gh pr create`)
- **Branch:** `cursor/funnel-pacing-rate-comparison-spend-tile`

## Summary

PR-C of the funnel-pacing convergence arc (#467). Builds on #474 (PR-B).
Adds two new diagnostic surfaces to the venue Funnel Pacing tab:

1. **Funnel Health Strip** — a three-row comparison banner at the top of
   the tab summarising Reach→Click / Click→LPV / LPV→Ticket rates against
   their benchmarks (14% / 50% / 5%) with ON TRACK / OFF TRACK status.
   Reads `venueCanonicalFunnel.stages[].conversionRate/.conversionBenchmark`
   — the same values rendered in the per-bar chips, promoted for upfront
   diagnostic visibility.

2. **Spend Reconciliation Card** — a new card between the health strip and
   the four stage bars showing: Spent, Allocated (£29,745 for Edinburgh),
   Remaining, Spent per day (derived from first-non-zero-spend date in
   rollups), Required per day (live CPT × tickets remaining / days to event),
   Suggested daily (= required per day), and a budget-sufficiency warning.

   Edge-case handling: event passed, sold out, null CPT, null allocated budget.

Both surfaces are zero-new-DB-queries: all inputs flow through
`buildVenueCanonicalFunnel`, which gains a new `spendReconciliation` output
shape and an optional `allocatedBudget` input (SUM of
`events[].budget_marketing`, sourced at the page level).

## Scope / files

- `lib/dashboard/venue-canonical-funnel.ts` — new `VenueSpendReconciliation`
  interface; `allocatedBudget` input; `computeSpendReconciliation` helper;
  `spendReconciliation` field on `VenueCanonicalFunnel`
- `lib/dashboard/__tests__/venue-canonical-funnel.test.ts` — 7 new
  `spendReconciliation` tests (Edinburgh shape, additional-needed,
  sold-out, event-passed, null-CPT, null-allocated, no-spend)
- `components/dashboard/clients/funnel-pacing-venue-view.tsx` — new
  `FunnelHealthStrip`, `SpendReconciliationCard`, `RequiredPerDayRow`,
  `WarningBanner`, `SpendRow`, `HealthBadge` sub-components; wired into
  `FunnelPacingVenueView`
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — compute
  `venueAllocatedBudget`; pass to `buildVenueCanonicalFunnel`
- `app/share/venue/[token]/page.tsx` — same wiring for public share surface

## Validation

- [x] `npm run build` — clean (Exit 0)
- [x] `npx eslint` on touched files — 0 errors (1 pre-existing warning on
  `_backward` in `purchaseStatus`, introduced in PR-B)
- [x] `node --test` on `venue-canonical-funnel.test.ts` — 22/22 pass
  (7 new `spendReconciliation` tests added in this PR)

## Edinburgh live verification (2026-05-28)

`allocatedBudget` sourced via `aggregateSharedVenueBudget` (MAX per event_code = £9,915,
matches Performance Summary "Paid media allocated" tile).

| Field             | Value               |
|-------------------|---------------------|
| Spent             | £9,410              |
| Allocated         | £9,915              |
| Remaining         | £505                |
| First spend date  | 2026-01-28          |
| Days of spend     | 120                 |
| Spent per day     | £78.42              |
| Live CPT          | £2.69               |
| Days to event     | 16                  |
| Tickets remaining | 1,977               |
| Required per day  | £332                |
| Warning           | `additional_needed` |

## Notes

- **Allocated source fix (post-initial-commit):** original implementation
  used `SUM(events[].budget_marketing)`, which inflated by fixture count on
  multi-fixture venues (Edinburgh: 3 × £9,915 = £29,745). Fixed in follow-up
  commit to use `aggregateSharedVenueBudget(venueEvents)` (MAX per event_code
  = £9,915) — the same helper Performance Summary uses. Same anti-pattern as
  the click-fanout fix in #472.
- PR-D will follow with the predictive projection chart (out of scope here).
- The spend allocator stall investigation is a separate Claude Code Opus
  diagnostic (not this branch).
- No changes to Performance Summary or admin routes.
- Refs: #474 (PR-B base), #468/#472/#473 (data layer), #467 (original design).
