# Session log

## PR

- **Number:** 898
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/898
- **Branch:** `cursor/plan-v2-learn-face`

## Summary

LEARN face (canon §2.4; E1–E7). Draft because PR 3 (#896) is unmerged: the face is built against the `campaign_plan_predictions` type with fixture data. Every closed plan on this branch renders E2 (`no prediction was stored for this plan — it launched before predictions were kept`) until 166 applies and a row is passed in.

## Scope / files

- `lib/plan/learn-face.ts` — copy, next-time `percentile_cont`, `CampaignPlanPrediction` (same shape as #896)
- `lib/plan/__tests__/learn-face.test.ts` — every E-state
- `components/plan/canvas-learn.tsx`
- `components/plan/plan-workspace.tsx` — mounts LEARN when the show has passed or the plan is archived
- viz-kit + drawer guards

## Ship-report

| Item | Canon | Frame | Pinning test |
|---|---|---|---|
| E1 sentence from the prediction row | §2.4 | E1 | `E1 sentence is built from the prediction row` |
| Next-time median six runs → £1.75, band £1.04–£2.10 | §2.4 amendment | E1 | `next-time median with the closed run added` |
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

## Validation

- [x] `npm test` (5158 pass, 3 skipped)
- [x] `npm run build`

## Contradiction — needs a ruling

None that stop the face. Draft because #896 is unmerged.

Readings:

1. Live wiring passes `prediction={null}` — E2 until 166 + a read path exist.
2. E7 uses `campaign_plans.updated_at` when `status = archived` (no `archived_at` column).
3. Canon example `Fri 6 Sep` is not 2026-09-06 (that day is Sunday). The header follows `formatVizDay`.
