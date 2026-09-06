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

## Notes

Open as a draft titled `[needs migration apply]`. Merge after A (#899) and after 169/170 are applied.
