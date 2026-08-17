# Session log

## PR

- **Number:** 777
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/777
- **Branch:** `cursor/destination-type-boost-compat`

## Summary

PR #770 regression (task #132 / subcode 1815676): setting
`destination_type=WEBSITE` on every traffic/registration ad set caused Meta
to reject existing-post (boost) ads with "Non-website ads are not allowed in
ad sets with website destination type". Reproduced on a v2 campaign where
Ad1/Ad2 (link) succeeded and Ad3 (IG existing post via object_story_id)
failed on all 5 ad sets. `destination_type` is now omitted whenever the
draft assigns any existing-post creative to that ad set; all-link ad sets
still get WEBSITE. Backfill script skips boost-bearing ad sets; Step 6
shows a soft info note for mixed boost+link assignments.

## Scope / files

- `lib/meta/adset.ts` — `hasBoostCreative` on resolve/build; `adSetHasBoostCreative` + `findAdSetsWithMixedBoostAndLinkCreatives`
- `app/api/meta/launch-campaign/route.ts` — `boostAdSetIds` from assignments; all 8 `buildAdSetPayload` call sites
- `scripts/backfill-traffic-destination-type.mjs` — skip ad sets with boost creatives
- `components/steps/assign-creatives.tsx` — mixed-assignment info note
- Tests: `adset-destination-type.test.ts`, placement-wiring boost-flag guard

## Validation

- [x] Unit tests (destination_type + placement wiring + blank) — 27/27 pass
- [x] eslint on touched files — 0 errors
- [ ] Manual: relaunch traffic campaign with link + existing-post creatives → boost ads create; link-only ad sets still show Website in Edit UI

## Notes

- Assignment matrix convention: `adSetId → creativeId[]` (Assign Creatives / invertAssignments).
- create-adsets route has no assignments → still defaults to WEBSITE for traffic (no boost path there).
