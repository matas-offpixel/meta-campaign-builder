# Session log

PR: https://github.com/matas-offpixel/meta-campaign-builder/pull/1124 (#1124)


## PR

- **Number:** 1124
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1124
- **Branch:** `cursor/creative-lab-voice`

## Summary

The caption writer takes its tone from the page's own Instagram captions. The seed examples stay the shape library. Hashtags are read as a trait and written only when the client's switch is on. A sign-off that closes three or more posts may end the primary text verbatim.

## Scope / files

- `supabase/migrations/215_creative_lab_voice.sql` — `voice_samples`, `voice_traits`, `clients.voice_hashtags_enabled`. Not applied.
- `lib/creative-lab/voice-traits.ts`, `voice-store.ts`, `voice-fixtures.ts`
- `lib/creative-lab/writer.ts` — voice block after the shape examples, omitted under 8 samples so today's prompt stays byte for byte
- `lib/creative-lab/ig-discovery.ts` — artist captions saved from the Find clips read; promoter own-edge read; nightly refresh of promoter pages read in the last 30 days
- Generator chip and sheet; CLV1–CLV4

## Validation

- [x] `npm test`
- [x] `npm run build`
- [ ] frames:check on CLV1–CLV4

## Notes

- `user_id` is on both voice tables so owner RLS matches the Lab tables. `page_ref` has no foreign key: it points at either `clients.id` or `creative_lab_artists.id`.
- The hashtag switch is `clients.voice_hashtags_enabled`, default false. The CLV2 drawing has no control, so the frames do not draw one. The live sheet has the switch.
- The sheet's sentence range is 2–12. The drawing's placeholder said 4–12. "Sold out." is two words.
- The four exemplar weekdays are the record's labels, not the 2026 weekday of those dates.
- Enzo's chip says 30 posts as drawn. Those captions are not on a sheet in CLV1.
- Under 8 posts the live chip says "Not enough posts yet · n of 8". CLV4 draws the record's longer sentence for Reeshy.
- Empty promoter state on the live chip says "No posts read yet — Read posts". CLV3 draws "No posts read yet — Find clips reads them."
- A page that cannot be read stores `{ "error": "..." }` on `voice_traits` with `sample_n` 0. No `clients.ig_last_error` column.
CLV1–CLV4 at 1280 and 393 rewritten from matching Ubuntu runs 42497321834 and 42497326107.

