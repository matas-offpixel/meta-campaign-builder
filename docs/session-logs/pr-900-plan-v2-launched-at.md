# Session log

## PR

- **Number:** 900
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/900
- **Branch:** `cursor/plan-v2-launched-at`

## Summary

`planLaunchStamp` reads `launched_at`, written once on the transition to live. `created_at` is prepare-draft and is never a launch time again. Live rows that already existed are backfilled from the plan window start (`launched_at_source = plan_start`); the header ⓘ says `launch time taken from the plan's start`.

## Scope / files

- `supabase/migrations/170_campaign_plan_launched_at.sql` — columns + backfill; Matas applies after 169
- `lib/plan/{types,load,persist,launch-face}.ts`
- `components/plan/{canvas-header,plan-workspace}.tsx`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5294 pass, 4 skipped)
- [x] Review round 1: rebased onto #899; `persist-handoff` + `launch-face` (46 pass)

## Notes

Open as a draft titled `[needs migration apply]`. Merge after A (#899) and after 169/170 are applied.

## Review round 1 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| Rebase onto fixed #899: A's `row` rebuild (`platform_ad_account_id`) and B's `launched_at` update must both survive | `lib/plan/persist.ts` `upsertPlanLaunchRow`; `lib/plan/{types,load}.ts`; `canvas-header.tsx` | `migration 169 stores the launched account on the ledger`; `live upsert writes launched_at once and never overwrites it`; `migration 170 adds launched_at and does not apply in this run` |
| Nothing else changes; 170 backfill stays plan-window start (D.O.D → Thu 27 Aug 10:27 London) | `supabase/migrations/170_campaign_plan_launched_at.sql` | same 170 test |
