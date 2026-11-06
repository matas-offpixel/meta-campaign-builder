# Session log

## PR

- **Number:** 1085
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1085
- **Branch:** `cursor/creative-lab-m3c`

## Summary

Creative Lab propose and launch were reading `artists.client_id`. That column does not exist, so every round threw before it could be built. The Lab artist row now carries the artist's own Page and Instagram account. A round stores the ad set's recorded objective and name. The long caption size is used when the overlay does not fit four lines at the default size. A city-level "back in [city]" claim needs a past show of the same client in that city. Migration 201 is written and not applied.

## Scope / files

- `supabase/migrations/201_creative_lab_m3c.sql` — `creative_lab_artists.meta_page_id`, `instagram_actor_id`; `creative_lab_rounds.meta_campaign_objective`, `meta_adset_name`, `meta_adset_status`. Not applied.
- `lib/creative-lab/propose.ts`, `launch.ts` — no roster lookup. Artist-voice ads use both Lab columns. A missing artist Instagram account fails before upload with "no artist Instagram account". No clips throws before any insert.
- `lib/creative-lab/lab-draft.ts` — the draft uses the recorded objective. A registration ad set is not written as `OUTCOME_SALES`.
- `lib/creative-lab/caption-facts.ts`, `past.ts`, `starting-caption.ts` — long size from the default wrap; city past claims; the starting caption is validated and inserted proposed.
- `components/dashboard/events/creative-lab-card.tsx` — Page picker from `/api/meta/pages`, Instagram from `/api/meta/page-identity`, Instagram clip permalinks.
- `lib/creative-lab/__tests__/schema-guard.test.ts` — every Creative Lab read must exist in `lib/db/database.types.ts`.
- `lib/db/database.types.ts` — the new columns, plus Row stubs for the tables the Lab already reads that were missing from the generated type. No DDL.

## Validation

- [x] `npx tsc --noEmit` on the files in this PR (repo-wide `tsc` still reports pre-existing errors outside this change). `next build` typecheck passed.
- [x] `npm run build`
- [x] `npm test` — 7595 node tests plus vitest, 0 failures, including the schema guard.
- [x] ESLint on the touched files.

## Notes

- Launch stays paused-only. `CREATIVE_LAB_LAUNCH_ENABLED` is not set. No files under `app/api/meta/**` or `lib/meta/**` were edited.
- Claude applies migration 201 after merge. Until then, saving an artist or proposing a round that has clips will fail on the new columns. The no-clips path does not write them.
- Read-only production check, 6 Nov 2026, no rows written. Enzo Siragusa `7bc3e3fa-b4e2-4b99-bc92-f76f9da04365` on P26-BDAY-DAY (`d2fa91e6-b245-4064-8a20-402a8c0a4dd1`): `proposeRound` returned `no_clips: no clips`. Clips 0. Rounds 0 before and after. Captions 3 before and after.
- Starting caption: "Back in Southampton on 27th December to close out the year w/ Puzzle." Style `lineup`. Size `long` (five lines at the default 18-character width). Long-size lines: "Back in Southampton on" / "27th December to close" / "out the year w/ Puzzle." `ok` false. The only error is `past_not_in_facts`: "a past appearance needs an artist and a city the record holds". The sentence names no artist, so the city claim is not backed.
- The event page was not opened in a browser. This branch is not deployed, and the page needs an operator session.
