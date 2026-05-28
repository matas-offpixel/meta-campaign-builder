# Session log — Funnel Pacing visual overhaul + Today alerts + client dashboard 3-state toggle

## PR

- **Number:** 484
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/484
- **Branch:** `cursor/funnel-pacing-visual-overhaul`

## Summary

Mega-PR (single branch, opened DRAFT) delivering three workstreams that share
the canonical funnel data source and a new pacing-status derivation layer:

- **A — Funnel Pacing tab redesign**: Northbeam-style visual language (gradient
  fills, benchmark-vs-actual chips, hero numbers, filled horizontal bars with
  embedded benchmark markers). New Hero Status Bar, Daily Spend Tracker, live
  Sliding Spend Scrubber driving the funnel stage bars and the upgraded Forward
  Projection Chart, tightened Spend-vs-Budget reconciliation bar, and a Pacing
  Verdict Card. Removed the Settings box, descriptive paragraph, and duplicate
  Funnel Health section.
- **B — Today dashboard pacing alerts**: server-rendered per-client alert cards
  (status pill + top 2–3 issues, deep links) at the top of `/today`.
- **C — Client dashboard 3-state toggle**: Stats / Pacing / Performance vs
  Allocation segmented control with localStorage persistence.

## Scope / files

Shared foundation:
- `lib/dashboard/benchmarks.ts` (new) — centralised benchmark accessor with a
  reserved per-event-type override hook (`_eventType`).
- `lib/dashboard/pacing-presentation.ts` (new) — 3-state tone math
  (above/within/below/neutral), centralised tone→colour map, `inverseTone` for
  lower-is-better metrics, verdict presentation.
- `lib/dashboard/venue-pacing-summary.ts` (new) — pure derivation of
  `VenuePacingRow`, `PacingVerdict`, `PacingIssue` (Today alerts), funnel
  segments (Workstream C Pacing), and `projectFunnelVolumes` (scrubber).
- `lib/dashboard/client-venue-pacing-rows.ts` (new) — assembler from
  `ClientPortalData` (reused by B and C).
- `components/dashboard/pacing/{benchmark-chip,gradient-bar,hero-status-bar}.tsx`
  (new) — visual primitives.

Canonical funnel (ONE new derived field, see below):
- `lib/dashboard/venue-canonical-funnel.ts` — added `dailySpendSeries`
  (`DailySpendPoint[]`) + `computeDailySpendSeries`. No query changes.

Workstream A:
- `components/dashboard/clients/funnel-pacing-interactive.tsx` (new) — scrubber
  + live stage bars (localStorage `funnel-scrubber-pos-{event_code}`).
- `components/dashboard/clients/daily-spend-tracker.tsx` (new)
- `components/dashboard/clients/spend-vs-budget-bar.tsx` (new)
- `components/dashboard/clients/pacing-verdict-card.tsx` (new)
- `components/dashboard/clients/funnel-projection-chart.tsx` (upgraded from #480)
- `components/dashboard/clients/funnel-pacing-venue-view.tsx` (rewired)

Workstream B:
- `lib/dashboard/client-pacing-alerts-server.ts` (new, server-only)
- `components/dashboard/today/client-pacing-alerts.tsx` (new)
- `app/(dashboard)/today/page.tsx` + `components/dashboard/today/today-dashboard.tsx`
  (alertsSlot via Suspense)

Workstream C:
- `components/dashboard/clients/client-stats-view-toggle.tsx` (new)
- `components/dashboard/clients/client-pacing-view.tsx` (new)
- `components/dashboard/clients/client-allocation-view.tsx` (new)
- `components/dashboard/dashboard-tabs.tsx` +
  `app/(dashboard)/clients/[id]/dashboard/page.tsx` (wired toggle)

Tests:
- `lib/dashboard/__tests__/venue-pacing-summary.test.ts` (new, 14 tests)

## Validation

- [x] `npx tsc --noEmit` — 0 errors in changed files (pre-existing test-file
  errors only: es2018 regex flag / readonly arrays, unrelated).
- [x] `npm run build` — passes (exit 0).
- [x] `npm test` — 14/14 new tests pass. 5 pre-existing failures remain
  (`server-only` module resolution under the node test runner) and fail
  identically on `main` — unrelated to this PR.
- [x] Lint — 0 errors in changed files; 1 warning (`_eventType` reserved
  override hook), consistent with the repo's existing `_`-prefixed convention.

## Notes

- **Canonical funnel change:** added exactly one new derived field
  (`dailySpendSeries`) as permitted. It reuses already-fetched `dailyRollups`
  (`ad_spend_allocated + ad_spend_presale` per date, trailing 14-day window) —
  no new Supabase query, no new Meta call.
- **Screenshots pending:** the autonomous build environment has no browser
  automation (Playwright/Puppeteer not installed; adding one would breach the
  no-new-deps rule) and no authenticated Supabase session for live
  4thefans/Edinburgh/Birmingham data. The 10 required screenshots must be
  captured manually before promoting the PR out of draft. The colour-inversion
  sanity checks were validated **computationally** instead (see PR body).
- **Follow-up flagged:** `deriveVenueIssues` "behind required pace" currently
  uses the current-day snapshot rather than a true rolling 3-day window
  (we only have the snapshot at this layer). Noted for a follow-up that reads
  the rolling window.
