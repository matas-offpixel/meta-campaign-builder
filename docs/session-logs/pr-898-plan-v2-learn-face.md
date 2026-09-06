# Session log

## PR

- **Number:** 898
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/898
- **Branch:** `cursor/plan-v2-learn-face`

## Summary

LEARN face (canon §2.4; E1–E7). Draft because PR 3 (#896) is unmerged: the face is built against the `campaign_plan_predictions` type with fixture data. Every closed plan on this branch renders E2 (`no prediction was stored for this plan — it launched before predictions were kept`) until 166 applies and a row is passed in.

## Scope / files

- `lib/plan/learn-face.ts` — copy; next-time via `metricChipBenchmarkFromRuns` (the #896 view window)
- `lib/plan/__tests__/learn-face.test.ts` — every E-state
- `components/plan/canvas-learn.tsx`
- `components/plan/plan-workspace.tsx` — mounts LEARN when the show has passed or the plan is archived
- viz-kit + drawer guards

## Ship-report

| Item | Canon | Frame | Pinning test |
|---|---|---|---|
| E1 sentence from the prediction row | §2.4 | E1 | `E1 sentence is built from the prediction row` |
| Next-time median from the view window (`planBenchmark`) | §2.4 + G34 | E1 | `next-time median is planBenchmark over the view's window` |
| E2 no prediction stored | §2.4 | E2 | `E2 has no prediction stored` |
| E3 date-lock days; count-lock (1 of 3) | §4.5 | E3 | `E3 date-lock is days` |
| E5 / E6 creative lock | §2.4 §1.6 | E5 E6 | `E6 client role removes the next-time column only` |
| E7 archive header | §2.4 amendment | E7 | `E7 archive header uses formatVizDay` |
| Past-tense identity | §2.4 | E1 | `past-tense identity` |
| `£35 per day, kept` | §2.4 U15 | E1 | `pace kept` |

## Walk

- E2 (today, every closed plan) — actual-only + `no prediction was stored…`
- E1 (fixture / after #896) — `We assumed £2.03…; D.O.D came in at £0.51 before general sale; the next NX plan will assume £1.75 (6 other shows)`
- E3 — Locked `opens when D.O.D closes (89 days)` · `opens after your 3rd NX show` + `(1 of 3)`
- E6 — same as E1 without the next-time column
- E7 — `closed when you archived it, Sun 6 Sep` (formatVizDay of the archive day; 2026-09-06 is Sunday)

## Rebase after #896 round 1

Rebased onto `cursor/plan-v2-migrations-166-167` (`132dd41`). Next-time is `learnNextTime` → `metricChipBenchmarkFromRuns` over the view's windowed runs plus this plan's actual. Windowed NX signup + DOD £0.51 → median **£1.10**, IQR £0.62–£1.58 (canon E1's £1.75 was the lifetime set — G34). Workspace still passes `prediction={null}` so every LEARN mount today is E2. LEARN still mounts only after close (live plans stay on ADJUST).

## Validation

- [x] `npm test` (see rebase commit)
- [x] `npm run build`

## Contradiction — needs a ruling

None that stop the face. Draft because #896 is unapplied. G34 decides whether E1's "next time" is the lifetime £1.75 or the windowed £1.10.

Readings:

1. E7 uses `campaign_plans.updated_at` when `status = archived` (no `archived_at` column).
2. Canon example `Fri 6 Sep` is not 2026-09-06 (that day is Sunday). The header follows `formatVizDay`.

## Review round 2 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| `LEARN_PACE_KEPT` was a constant | `formatPaceKept(plan.intent.budget.totalDaily)`; `formatPaceValues` | `pace kept is built from the plan daily` — `the plan said £3,465 · D.O.D spent £5,544 · next time £35 per day, kept` |
| Every Locked child was the word `Locked` | `LearnLockedSkeleton` (heads at 35% ink + dashed bar) | `Locked children are the exhibit skeleton` |
| `venueLabel = "NX"`; `(1 so far)` | no default; `formatCountLock` is `(1 of 3)` | `opens after your 3rd show (1 of 3)` |
| `prediction={null}` hard-wired | `page.tsx` `loadPlanPredictions`; workspace `learnPrediction` | `page reads campaign_plan_predictions`; workspace no longer `prediction={null}` |
| `actual` never written | archive route `loadPlanWindowActual` → `archiveCampaignPlan(..., actual)` | `archive writes actual`; `planWindowActual(554/1086)` → 0.51 |

**Open item:** show-close writer on `rollup-sync-events` (day after `event_date`, once, DB-only). Out of scope for this PR — archive writes the actual now.

## Validation

- [x] `npm test` (round 1)
- [x] `npm test` (round 2) — 5210 pass, 4 skipped
- [x] `npm run build` (round 2)
