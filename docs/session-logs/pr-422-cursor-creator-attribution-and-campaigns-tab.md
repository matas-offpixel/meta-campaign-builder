# Session log — attribution gap classifier + internal campaigns tab

## PR

- **Number:** #422
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/422
- **Branch:** `cursor/creator/attribution-and-campaigns-tab`

## Summary

Two paired surfaces in one PR, both leaning on the same
canonical-event-metrics extension:

1. **Attribution gap tile** (client-facing) — four-state classifier
   (`no_data` / `capi_missing` / `over_attributed` / `tracked` with
   green/amber/red sub-bands on the tracked state) surfacing
   Meta-reported `meta_regs` vs real `ticketsTrue` per event_code.
   Tile renders on the venue Performance tab (internal + share, same
   `<VenueFullReport>` component drives both surfaces).
2. **Internal campaigns tab** (`/clients/[id]/campaigns`) — Meta
   sub-tab active, TikTok + Google sub-tabs visible-but-disabled.
   Reads `active_creatives_snapshots`, aggregates creatives →
   campaigns / ad-sets at read time, splits Meta purchases + a
   spend-share-allocated "Sales (est.)" column, surfaces ⚠️ when
   `Meta CPA` and `CPA (est.)` diverge by >3× OR when one side is
   null while the other is populated (capi_missing demo case).

Thesis: the broken `meta_regs` data IS the demo on the client tile
(we do NOT dedup here); on the internal tab we cross-show measured
Meta-reported figures alongside spend-share-estimated figures and
label aggressively. This is Bucket A item #2 of PR #421 (docs-only
proposal).

## Scope / files

### CREATE

- `supabase/migrations/092_attribution_canonical_extensions.sql` —
  read-side `v_event_code_attribution_snapshot` view (no new write
  paths; existing PK index covers reads, no extra index added).
- `lib/dashboard/attribution-state.ts` — pure classifier
  (`computeAttributionState`, `worstAttributionState`,
  `attributionSortKey`).
- `components/dashboard/event-report/AttributionGapTile.tsx` —
  big-number + state badge + collapsible explainer.
- `components/dashboard/client-portal/AttributionGapColumn.tsx` —
  compact pill + dot-only `compact` variant for the campaigns-tab
  ad-set rows.
- `app/(dashboard)/clients/[id]/campaigns/page.tsx` — convenience
  redirect into `/clients/[id]?tab=campaigns` (the campaigns surface
  ships as a tab on the existing client-portal shell).
- `components/dashboard/campaigns/client-campaigns-tab.tsx` — the
  tab shell: sub-tab nav (Meta active, TikTok / Google stubbed),
  filter row (Active/All + event-code multi-select), "Last
  refreshed" header, manual refresh button.
- `components/dashboard/campaigns/campaigns-table.tsx` — sortable
  campaign + expandable ad-set table with the 12 columns from the
  prompt.
- `lib/dashboard/campaigns-aggregator.ts` — pure aggregator over
  `ShareActiveCreativesResult.groups` → campaigns + ad-sets;
  spend-share allocation; CPA divergence; worst-state badge
  inheritance.
- `lib/dashboard/campaigns-loader.ts` — server loader joining
  `loadClientPortalByClientId` + lifetime-meta cache rows + the
  `active_creatives_snapshots` table for the page.
- Tests — see Validation below.

### EXTEND

- `lib/dashboard/canonical-event-metrics.ts` — `ticketsTrue`,
  `attribution`, `attributionRate` exposed on the canonical struct;
  multi-link SUM-before-delta on tickets side honoured inside the
  resolver.
- `lib/dashboard/canonical-event-metrics-loader.ts` — wires through
  the new `tierChannelTicketsByEventId` input.
- `components/share/venue-full-report.tsx` — renders the tile in
  the venue Performance tab (internal + share both flow through
  `<VenueFullReport>`).
- `components/dashboard/clients/client-detail.tsx` — Campaigns tab
  between D2C and Creatives Templates.
- `app/(dashboard)/clients/[id]/page.tsx` — `loadClientCampaignsData`
  added to the parallel pre-fetch + threaded into `<ClientDetail>`.

### DO NOT TOUCH (held line)

- `lib/ticketing/**`
- `lib/insights/event-code-lifetime-two-pass.ts`
- `dedupVenueRollupsByEventCode` (NOT applied to `meta_regs`)
- `proxy.ts`
- PR #421 docs

### Scope deferrals (intentional)

- TikTok + Google campaigns sub-tabs — stubbed nav now, surfaces
  follow-on PR.
- `meta_regs` dedup — follow-on PR. Brighton must look wrong.
- Client-portal events-table per-row Attribution column — the table
  is venue-grouped (internal uses `<VenueEventBreakdown>`, share
  uses the 13-col flat table). The venue-level Attribution data is
  surfaced via the `<AttributionGapTile />` on the venue
  Performance tab, which inherits the same classifier and renders
  for every venue with data. A flat-table column addition is left
  to a follow-on PR rather than a partial implementation that
  diverges across the two table renderers.
- Per-order email match (Phase 1a) — gated on the Joe response and a
  client-side pixel work item.

## Validation

- [x] 386/387 dashboard tests pass (1 pre-existing skip).
  - `lib/dashboard/__tests__/attribution-state.test.ts` (12 cases
    covering all states, bands, sort key, worst-state pick).
  - `lib/dashboard/__tests__/canonical-event-metrics-attribution.test.ts`
    (5 pinned states from the prompt + 3 multi-link cases).
  - `lib/dashboard/__tests__/campaigns-aggregator.test.ts` (17
    cases covering snapshot dedup, spend-share allocation, worst-
    state badge inheritance, ⚠️ divergence including the
    Shepherd's Bush capi_missing case, isDivergent edge cases).
- [x] `npm run build` — clean (Turbopack, Next 16).
- [x] `npm run lint` — no new errors / warnings on the changed
  files (pre-existing repo-wide errors unchanged).

After merge:

- [ ] Paste prod URLs (WC26-LONDON-SHEPHERDS, WC26-BRIGHTON,
  WC26-EDINBURGH, `/clients/{4thefans}/campaigns`) into PR comment
  with screenshots.
- [ ] BB26-KAYODE event report regression-check: tile must NOT
  render (awareness gating).

## Notes

- Phase 1a (per-order email match) is gated on the Joe response
  and a client-side pixel work item — explicitly deferred.
- `meta_regs` dedup is a follow-on PR. The whole point of the
  `over_attributed` state is that Brighton looks wrong; do not
  silently dedup.
- TikTok + Google sub-tabs follow-on PR; this PR stubs the nav so
  the structure is visible.
- The `/clients/[id]/campaigns` URL works as a deep-link via a
  redirect into `/clients/[id]?tab=campaigns` so the campaigns
  surface stays inside the same tabs-shell as the rest of the
  client portal.
