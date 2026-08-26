# Session log

## PR

- **Number:** 846
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/846
- **Branch:** `cursor/plan-d1` (stacked on `cursor/plan-d0`)

## Summary

Campaign plan model: platform-neutral intent on `campaign_plans`, first-class `live_partial`, per-adapter 1:1 launch tables (no platform enum column). Types in `lib/plan/types.ts`.

## Scope / files

- `supabase/migrations/157_campaign_plans.sql` — not applied
- `lib/plan/types.ts`
- `lib/plan/__tests__/types.test.ts`

## Inventory

- No `audience_clusters` or `creative_sets` table. Cluster refs are `ClusterLabel` strings (`lib/interest-suggestions.ts`). Stored as text, no FK.
- Live Google prior art is `google_search_plans` (096, status includes `partially_pushed`), not legacy `google_ad_plans` (017). Google launch child `draft_id` references `google_search_plans`.
- `ad_plans` (005) is the daily pacing artefact — different object. RLS pattern (`auth.uid() = user_id`) reused.
- `campaign_drafts.event_id` is nullable; plan `event_id` is required (plan is event-scoped).
- v1 decision 2: no platform enum on the plan. Splits are named columns; outcomes are three tables.

## Validation

- [x] `npm test` — 4436 pass, 0 fail, 3 skipped
- [x] `npx eslint lib/plan/types.ts lib/plan/__tests__/types.test.ts` — clean
- [x] `npm run build` — compiled successfully

## Notes

- Falsification: `git show cursor/plan-d0:lib/plan/types.ts` exits 128 (path does not exist on parent `080424a`). New tests cannot load against the parent sha.
