# Session log

## PR

- **Number:** 919
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/919
- **Branch:** `cursor/plan-phases`

## Summary

Schema and backfill so a campaign plan can name its phase. Settled 2026-09-08: `ad_plans` owns the money, the day grid and the target; `campaign_plans` owns the launch and is a phase (`presale` · `on_sale` · `waiting_list`). One event → one `ad_plans` row → several `campaign_plans` rows. Today those rows cannot say which phase they are. No canvas, no frames, no row deleted.

## Scope / files

- `supabase/migrations/173_campaign_plans_phase.sql` — `campaign_plans.phase` (nullable, three values), `events.sold_out_at`, backfill of the eight existing rows
- `supabase/migrations/174_campaign_plans_event_phase_unique.sql` — `unique (event_id, phase)`. Written, **not applied**. Folamour's three junk rows would violate it
- `supabase/schema.sql` — `events.sold_out_at`
- `lib/db/database.types.ts` — `events.sold_out_at`
- `lib/plan/phase.ts` — `deriveCampaignPlanPhase` (mirrors 173; not rendered)
- `lib/plan/phase-reconcile.ts` — signed unallocated helper (not rendered)
- `lib/plan/__tests__/phase-reconcile.test.ts`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5413 pass, 4 skipped)
- [ ] Matas applies **173** to prod, then CI. **Do not apply 174** until he deletes the Folamour junk rows

## Backfill (prod, 2026-09-08)

Phase is derived from the row's `start_date` against that event's UTC calendar date of `presale_at` / `general_sale_at`. `sold_out_at` is null on every event today, so `waiting_list` cannot match. No row is defaulted to `on_sale`.

| id | name | event | start | presale_at | general_sale_at | phase |
|---|---|---|---|---|---|---|
| `299dd4e5-cc76-4419-a5a0-eec5896c95ef` | DOD Plan | D.O.D `NX26-DOD` | 2026-08-27 | — | 2026-09-04 13:00Z | **null** — start before general sale, no presale span |
| `abf386e4-c234-4a41-927a-682188eed0e1` | Test | Jamie Jones `IRW0001` | 2026-08-26 | — | — | **null** — no sale dates |
| `49803b0d-e352-4115-aeb9-88de31d8b3d3` | Test 5 | Jamie Jones `IRW0001` | — | — | — | **null** — no start, no sale dates |
| `fb059252-b3a0-47f0-970c-6e7028a69018` | (empty) | Mall Grab `ES26-MALLGRAB` | 2026-08-27 | 2026-08-06 09:00Z | 2026-08-07 09:00Z | **on_sale** |
| `cbd199a5-f30c-4457-ae33-43d5615c7e13` | (empty) | DJ EZ `NX26-DJEZ` | 2026-09-07 | 2026-08-21 11:00Z | 2026-08-21 13:00Z | **on_sale** |
| `20a94559-b03b-4c14-abf1-c0a6ac0be9a0` | (empty) | Folamour `NX26-FOLAMOUR` | 2026-09-07 | — | 2026-09-03 13:00Z | **on_sale** |
| `c565fdde-1dda-4f6b-ab88-4345c0067c59` | (empty) | Folamour `NX26-FOLAMOUR` | 2026-09-07 | — | 2026-09-03 13:00Z | **on_sale** |
| `18dab888-1aef-492c-8145-2f9c12550f9f` | (empty) | Folamour `NX26-FOLAMOUR` | 2026-09-07 | — | 2026-09-03 13:00Z | **on_sale** |

Schak has no `campaign_plans` row (and no sale dates). The named nulls are D.O.D and the two Jamie Jones rows.

## Folamour junk — 174 stays unapplied

Three unnamed £0 rows, 7 Sep → 23 Oct, created while the canvas was walked on 7 Sep. They all backfill to `on_sale` and would violate `unique (event_id, phase)`:

- `20a94559-b03b-4c14-abf1-c0a6ac0be9a0` created 2026-09-07 21:15:38Z
- `c565fdde-1dda-4f6b-ab88-4345c0067c59` created 2026-09-07 22:05:27Z
- `18dab888-1aef-492c-8145-2f9c12550f9f` created 2026-09-07 22:25:28Z

Deleting them is a destructive act on Matas's data and is his to authorise. This PR does not delete any row.

## Flag, do not fix — G34 contamination

`campaign_plan_benchmarks_v` windows the `purchase` unit to on-and-after general sale (G34). Under the settled model, `waiting_list` spend also falls after general sale — but it is not buying tickets; it is capturing demand for tickets that may not exist. Left alone, waiting-list spend lands in the per-purchase benchmark and makes the on-sale cost look worse than it was.

That is a canon amendment to G34, not a code change to make blind. The £16.01 the canvas draws for NX Newcastle is computed this way. Matas's ruling. This PR does not touch the view, `lib/plan/benchmark-window.ts`, or any face.

## Notes

- `ad_plan_days.phase_marker` is a different concept. Not reused.
- `events.sold_out_at` is hand-set. Do not infer from ticket count or capacity (Boston Manor Park, Junction 2).
- Reconcile fixtures: Folamour ad plan 26 Aug → 23 Oct = 59 days; phase 7 Sep → 23 Oct = 47. D.O.D ad plan 27 Aug → 4 Dec = 100; phase = 1. `total_daily_budget` is daily × days.
- `ENABLE_PLAN_FANOUT` and `OFFPIXEL_TIKTOK_WRITES_ENABLED` unchanged. No launch caller.
- No canvas, no frames, no `/plan/new` change.
