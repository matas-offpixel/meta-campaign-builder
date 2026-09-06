# Session log

## PR

- **Number:** 896
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/896
- **Branch:** `cursor/plan-v2-migrations-166-167`

## Summary

Prediction row, venue key, and benchmark view for plan v2 (audit two §1–§2, §6; canon §1.2, §1.3). Three migrations, unapplied. Read path is `lib/plan/benchmarks.ts`. Write path writes a prediction at Launch when the plan has a target, and an actual at archive when the caller passes the number. LEARN is not wired.

## Scope / files

- `supabase/migrations/166_campaign_plan_predictions.sql` — audit two §2 DDL verbatim; docstring says the window is days
- `supabase/migrations/167_events_venue_key.sql` — `events.venue_key` + SQL backfill matching `lib/plan/venue-key.ts`
- `supabase/migrations/168_campaign_plan_benchmarks_v.sql` — run-grain view over `venue_key` with G34 windows
- `lib/plan/venue-key.ts` + `lib/plan/__tests__/venue-key.test.ts`
- `lib/plan/benchmarks.ts` + `lib/plan/__tests__/benchmarks.test.ts`
- `lib/plan/predictions.ts` + `lib/plan/__tests__/predictions.test.ts`
- `app/api/plan/launch/route.ts` — write at Launch (soft-fail if 166 unapplied)
- `lib/plan/dispose.ts` — write actual at archive when `actual` is passed
- `CLAUDE.md` — latest migration line

## Ship-report

| Item | Canon | Source | Pinning test |
|---|---|---|---|
| 166 predictions DDL; window is days | §1.3; audit §2, §6.10 | 166 | `predictions.test.ts` |
| Venue key collapses 4theFans triples with spend | §1.2 (2); audit §6.1 | 167 + `venue-key.ts` | `venue-key.test.ts` |
| NX lifetime median £2.03, IQR £1.46–£2.12 | §1.2; audit §1 | fixtures | `benchmarks.test.ts` |
| J2 usual £2.85, band £1.94–£4.10, Hard Techno £4.68 excluded | brief §2 | fixtures | `benchmarks.test.ts` |
| View windows: before general sale / last ticket day | G34; §2.3 G31 | 168 | `benchmarks.test.ts` · 168 grep |
| Read path is the only median | §1.5 rule 1 | `benchmarks.ts` | removal test |
| Write at Launch; actual at close | §1.3 | launch route + dispose | `predictions.test.ts` + launch grep |

## Validation

- [x] `npm test` (5156 pass, 3 skipped)
- [x] `npm run build`
- [ ] migrations **not** applied

## Contradiction — needs a ruling

**G34.** Audit two §1's Electric Brixton × NX × signup (lifetime / unwindowed) is n = 5, median **£2.03**, IQR **£1.46–£2.12** (costs £0.90 · £1.46 · £2.03 · £2.12 · £5.63).

The same five runs, days strictly before `general_sale_at` (brief §4 / G34): **£2.75 · £1.32 · £0.87 · £1.67 · £0.54**. Median of that set is **£1.32**, not £2.03.

The view keeps the canon window (`before general sale` for signup). The lifetime £2.03 set is pinned as a fixture of the audit query; it is not what the view will return once applied. Matas: which number is the line on A4 / J2 after 168 is applied?

## Readings (not stop-the-PR)

- The view is the **run grain** so the read path can exclude this plan's event (audit §1.1). Median/IQR live in `lib/plan/benchmarks.ts` (`percentile_cont`).
- Launch writes the plan's own target as the prediction until the view is applied and the launch route can pass a benchmark. No number is invented: no target → no row.
- Archive writes `actual` only when the caller passes the computed cost. Show-passed close is the same writer with `closedReason: "show"` — not on a cron.
- `n = 0` from `planBenchmark` is `undefined` (J7 / not-yet). Starting point is a face concern, not this function.
