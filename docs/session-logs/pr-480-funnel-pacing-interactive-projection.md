# Session log — funnel-pacing interactive projection (PR-D)

## PR

- **Number:** pending
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/480
- **Branch:** `cursor/funnel-pacing-interactive-projection`

## Summary

PR-D of the funnel-pacing convergence arc. Adds an interactive predictive
projection chart to the venue Funnel Pacing tab, below the sliding scale.
The operator can project forward — "if I keep spending £X/day, how many
tickets by event date, and do I sell out?" — with a Time/Spend x-axis
toggle. Three projection lines: Current pace (actual spend × live CPT),
Required pace (live CPT, sells out exactly on event date), Suggested
(benchmark CPT). Pure presentation over the canonical-funnel object already
on the page. No source-of-truth code touched.

## Scope / files

New:
- `lib/dashboard/funnel-projection.ts` — pure projection model
  (`buildFunnelProjection`); reshapes canonical-funnel fields only, no DB/network
- `lib/dashboard/__tests__/funnel-projection.test.ts` — 15 unit tests
- `components/dashboard/clients/funnel-projection-chart.tsx` — `"use client"`
  hand-rolled SVG chart matching `event-trend-chart.tsx`'s visual language;
  Time/Spend tablist toggle (localStorage-persisted via `useSyncExternalStore`),
  sellout + event-date markers, hover tooltip (6 fields), warning banner,
  `<figcaption>`, empty/pre-launch/unavailable states

Edited (wiring only):
- `components/dashboard/clients/funnel-pacing-venue-view.tsx` — render chart
  below `SlidingScaleCard`; new `eventDate` prop
- `components/dashboard/clients/funnel-pacing-section.tsx` — thread
  `venueEventDate`
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — pass
  `displayEventDate` (already in scope)
- `app/share/venue/[token]/page.tsx` — same (share parity)

## Canonical builder

**No changes to `lib/dashboard/venue-canonical-funnel.ts`.** `eventDate` is
threaded from the page (both pages already compute `displayEventDate` and pass
it into `buildVenueCanonicalFunnel`) rather than added to the builder output —
so the one-field budget was not needed.

## Data sourcing

- **No new Supabase queries.** All inputs come from the already-hydrated
  canonical funnel + `displayEventDate`.
- **No new Meta API calls.**

## Validation

- [x] `npm run build` — clean
- [x] tests — 37 pass (15 projection + 22 canonical), 0 fail
- [x] `npx eslint` — 0 errors on touched files

## Live Edinburgh render values (Supabase MCP, 2026-05-28)

The projection helper output matches a hand-SQL computation exactly:

| Field | Value |
|---|---|
| Capacity | 5,476 |
| Sold | 3,828 (remaining 1,648) |
| Spent | £6,985.72 (£55.01/day) |
| Live CPT | £1.82 |
| Days to event | 16 (event 13 Jun) |
| Current pace endpoint | ~4,310 / 5,476 → short of sellout |
| Required/day (live) | £188 |
| Suggested/day (benchmark) | £494 |
| Sellout crossing | none within window (≈54 days at current pace) |
| Banner | additional_needed (matches canonical `warning`) |

## Screenshots

Not captured from the agent environment: the dashboard is invite-only
(magic-link auth) and reads live Supabase data, and no headless browser
(Playwright/Puppeteer) is installed. The 4 required screenshots need manual
capture in a running authenticated session:

1. Edinburgh internal Funnel Pacing — Time axis
2. Edinburgh internal Funnel Pacing — Spend axis
3. Edinburgh public share Funnel Pacing — Time axis
4. 375px mobile — Time axis

Repro: open `/clients/{id}/venues/WC26-EDINBURGH` (Pacing tab) and the
matching `/share/venue/{token}`. The chart renders below the sliding scale
with the values in the table above.

## Modelling note (for review)

Required and Suggested share an identical ticket-vs-time trajectory (both
reach capacity at event date) and diverge only in £/day — visible on the
Spend axis and in the legend/figcaption. Current pace is the line that
diverges on the Time axis. The canonical funnel exposes
`warning ∈ {additional_needed, pace_covered, null}` (two states); the spec's
amber "ahead_of_pace" state is not currently derivable without new warning
logic in the canonical builder, which the brief forbids — flagging in case
you want a follow-up field.
