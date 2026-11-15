# Session log

## PR

- **Number:** 1086
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1086
- **Branch:** `cursor/creative-lab-m3d`

## Summary

A new Lab artist had no Page options, because the picker waited for a round's ad account. The list now comes from the client's ad account, or the event's when the client has none. Saving an unchanged Page keeps the stored Instagram actor. A city the operator confirms on the artist counts as a past appearance even when another promoter ran the show. Migration 202 is written and not applied.

## Scope / files

- `supabase/migrations/202_creative_lab_m3d.sql` — `creative_lab_artists.played_cities text[] not null default '{}'`. Not applied.
- `lib/db/creative-lab.ts` — card ad account is `clients.meta_ad_account_id`, else the event's. Artists carry `playedCities`.
- `components/dashboard/events/creative-lab-card.tsx` — Pages from `GET /api/meta/pages`, name with id. Instagram from `GET /api/meta/page-identity`, account name and actor id. "Played before (cities)" on the artist row.
- `lib/creative-lab/card-write.ts` — an unchanged Page does not clear `instagram_actor_id`. A different Page may replace it.
- `lib/creative-lab/caption-facts.ts` — a "back in [city]" claim passes when the city is in the speaking artist's `playedCities`, or a past client event holds it.
- `lib/db/database.types.ts` — `played_cities` on the Lab artist row. No DDL.

## Validation

- [x] `npx tsc --noEmit` on the files in this PR (repo-wide `tsc` still reports pre-existing errors outside this change, including `scripts/out`). `next build` typecheck passed.
- [x] `npm run build`
- [x] `npm test` — 7598 node tests, 0 failures; vitest 8 passed.
- [x] ESLint on the touched files.

## Notes

- No files under `app/api/meta/**` or `lib/meta/**` were edited. Launch stays paused-only. `CREATIVE_LAB_LAUNCH_ENABLED` is not set.
- Claude applies migration 202 after merge. Migration 201 is also still unapplied. Until both are applied, saving an artist names columns production does not have yet.
- Read-only production check, 6 Nov 2026, no rows written. Enzo Siragusa `7bc3e3fa-b4e2-4b99-bc92-f76f9da04365`, starting caption "Back in Southampton on 27th December to close out the year w/ Puzzle.", evaluated as `artist_first_person` with simulated `played_cities` `['Southampton']` (not stored). Style `artist_first_person`. Size `long`. Lines: "Back in Southampton on" / "27th December to close" / "out the year w/ Puzzle." `ok` true. Errors none. Captions 3 before and after. The client's ad account is set, so the Page list has a source.
- The event page was not opened in a browser. This branch is not deployed, and the page needs an operator session.
