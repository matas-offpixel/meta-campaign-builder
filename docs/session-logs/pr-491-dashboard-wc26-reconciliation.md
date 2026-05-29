# Session log — WC26 dashboard reconciliation

## PR

- **Number:** 491
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/491
- **Branch:** `cursor/dashboard-wc26-reconciliation`

## Summary

Overnight mega-PR reconciling the live dashboard with
`WC26_funnel_cross_reference.xlsx`. Shipped 4 of the 6 requested
workstreams to a finished, tested state; the other 2 were flagged (one
disproven, one blocked) rather than half-shipped, per the prompt's
tiebreaker rules. Audit-first surfaced three incorrect premises in the
brief — documented inline and in `docs/WC26_workstream_b_spend_audit.md`.

## Workstream outcomes

- **A (P0) — Target capacity — DONE.** Migration `100_event_target_capacity.sql`
  (additive nullable `events.target_capacity`), applied to prod via
  Supabase MCP + populated for all 16 WC26 venues (59 rows). New
  `aggregateSharedVenueCapacity()` helper: `MAX(target_capacity) ??
  SUM(capacity)`. Rewired the 3 canonical-funnel feeders (internal venue
  page, share venue page, `client-venue-pacing-rows`). Threaded
  `target_capacity` through `PortalEvent` + the events SELECT. 9 unit
  tests.
  - **Deviation from brief:** fallback is `?? SUM(capacity)`, NOT
    `?? MAX(capacity)`. The canonical builder has always SUMmed
    per-fixture capacity; a MAX fallback would silently regress every
    non-WC26 venue and the KOC-* brackets. Documented in the migration +
    helper docstrings.
- **B (P0) — Spend rollup-sync — AUDIT ONLY, no change.** The premised
  ACTIVE-only campaign filter does not exist (the fetch filters by
  `campaign.name CONTAIN` only). The dashboard already reads
  `ad_spend_allocated + ad_spend_presale`, and the allocator has reached
  100% event coverage since #481/#483 merged — live spend now matches
  Excel within ±£100 on the P0 venues (Edinburgh £7,025 vs £7,024,
  Brighton £6,696 vs £6,694). No backfill fired (would be a no-op +
  rewrites all clients). Full report:
  `docs/WC26_workstream_b_spend_audit.md`.
- **C (P1) — Run Rate Forecast — DONE.** `avgDailySalesToDate` +
  baseline projection + 4 capacity-uplift surge scenarios added to
  `buildVenueCanonicalFunnel` (`runRate`). New `RunRateForecast`
  component placed above the Forward Projection chart. Share-parity via
  the shared `FunnelPacingVenueView`. Tests included.
- **D (P1) — CPT at sellout + budget anchor — DONE.** `cptProjection`
  added to the canonical funnel (CPT-at-sellout, budget-anchor CPT,
  headroom delta + tone). Rendered in `SpendVsBudgetBar`. Share-parity.
  Tests included.
- **E (P1) — Live Daily Budget portfolio column — FLAGGED, not built.**
  Blocked: the `user-meta-ads` MCP server is errored, and there is no
  existing portfolio-level daily-budget aggregation to reuse — building
  one introduces a per-venue Meta fan-out (violates "no new Meta call
  pattern" / "reuse, don't re-query"). Needs scope confirmation.
- **F (P1) — Glasgow Combined aggregate — FLAGGED, not built.** Existing
  `wc26-glasgow-umbrella.ts` is spend-routing, not a UI aggregate-row
  pattern. A combined expand/collapse row on the client dashboard stats
  table is a substantial, regression-prone change to a core internal
  surface + a new migration; deferred over half-shipping.

## Scope / files

- `supabase/migrations/100_event_target_capacity.sql` (new)
- `lib/db/client-dashboard-aggregations.ts` (`aggregateSharedVenueCapacity` + `target_capacity` on `AggregatableEvent`)
- `lib/db/client-portal-server.ts` (`PortalEvent.target_capacity`, SELECT, mapping)
- `lib/dashboard/venue-canonical-funnel.ts` (`runRate`, `cptProjection` + helpers)
- `lib/dashboard/client-venue-pacing-rows.ts`, `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`, `app/share/venue/[token]/page.tsx` (capacity rewiring)
- `components/dashboard/clients/run-rate-forecast.tsx` (new), `spend-vs-budget-bar.tsx`, `funnel-pacing-venue-view.tsx`
- Tests: `lib/db/__tests__/aggregate-shared-venue-capacity.test.ts`, `lib/dashboard/__tests__/venue-canonical-funnel-runrate-cpt.test.ts`
- Docs: `docs/WC26_funnel_cross_reference.xlsx`, `docs/WC26_dashboard_audit.md`, `docs/WC26_workstream_b_spend_audit.md`

## Validation

- [x] `npx tsc --noEmit` — 0 new errors in production source (pre-existing test-file errors in `lib/audiences/__tests__` are unrelated)
- [x] `node --test` on new + existing canonical-funnel suites — 43/43 pass
- [ ] `npm run build` — not run (draft)
- [ ] Screenshots — not capturable in this environment (no browser); flagged in PR

## Notes

- Migration applied to prod (additive, nullable, reversible) + data
  populated; verified column exists and 59 rows set.
- Could not produce the requested before/after screenshots or
  independently verify Excel's Meta-direct numbers (Meta MCP errored).
