# Session log — Funnel Pacing tidy-up (post-#484)

## PR

- **Number:** 485
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/485
- **Branch:** `cursor/funnel-pacing-tidy-up`

## Summary

Five focused re-organisation changes to the Funnel Pacing tab shipped in #484.
Removes redundant surfacing of the required-£/day figure, adds the missing
daily-budget context (current vs required vs gap), makes the spend scrubber
budget-aware, makes the verdict-card maths explicit, and folds tickets-remaining
into the hero. No data-layer or canonical-builder changes; no other tab touched.

## Scope / files

- `components/dashboard/pacing/hero-status-bar.tsx` — Tickets-sold sub now reads
  "{sold} remaining of {cap}" (Task 5); Days-to-event segment now renders the
  daily-budget gap readout (Task 2); `sub` accepts a node; new `clientId`/
  `eventCode` props.
- `components/dashboard/pacing/hero-daily-budget-readout.tsx` (NEW, client) —
  reads the live Meta daily budget from the same in-memory cache the Performance
  tab populates (`getDailyBudgetUpdate`) and shows Budget / Required / Room.
- `components/dashboard/clients/funnel-pacing-interactive.tsx` — scrubber shows
  "Total spend at this pace: £X over Y days" with an over-allocated red state
  (Task 3); allocated-budget ceiling marker on the track (Task 3); preset £/day
  chips removed, position markers are now clickable snap targets (Task 1).
- `components/dashboard/clients/pacing-verdict-card.tsx` — removed the
  "Required / day" tile (Task 1) and "Tickets remaining" tile (Task 5); now a
  3-tile row (Days to event / Budget remaining / Actual 14d avg); added a native
  `<details>` "Why this number?" derivation (Task 4).
- `components/dashboard/clients/funnel-pacing-venue-view.tsx` — passes
  `clientId`/`eventCode` into the hero.

## Validation

- [x] `npm run build` — passes (exit 0).
- [x] Lint — 0 problems in changed files.
- [x] `node --test` — pacing-summary + canonical-funnel suites: 36/36 pass.
- [x] Verdict-math sanity (computed): £1.81 CPT × 1,619 = £2,933 required;
  £9,915 − £6,985 = £2,930 remaining; additional needed £3 — matches canonical
  `warningAmount` (£3).

## Notes

- **Required-£/day consolidation:** the headline figure stays on the Spend vs
  Budget card. It is *also* shown in the hero Days-to-event gap readout because
  Task 2 explicitly wants the current-vs-required comparison there — that is the
  one intentional second reference, down from three.
- **Screenshots:** before/after capture still requires a browser + authenticated
  session, which the autonomous environment lacks. The before/after Edinburgh
  screenshot must be attached manually before/at review. The verdict-math change
  is evidenced by the computed derivation above instead.
- The hero daily-budget readout shows "—" until the Performance tab populates
  the budget cache (same dependency the Daily Spend Tracker already has).
