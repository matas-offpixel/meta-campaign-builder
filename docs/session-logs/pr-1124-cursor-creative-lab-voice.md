# Session log

PR: https://github.com/matas-offpixel/meta-campaign-builder/pull/1124 (#1124)


## PR

- **Number:** 1124
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1124
- **Branch:** `cursor/creative-lab-voice`

## Summary

The caption writer takes its tone from the page's own Instagram captions. The seed examples stay the shape library. Hashtags are read as a trait and written only when the client's switch is on. A sign-off that closes three or more posts may end the primary text verbatim.

## Scope / files

- `supabase/migrations/215_creative_lab_voice.sql` — `voice_samples` with foreign keys on `client_id` and `artist_id` (cascade). No `voice_traits` table. `clients.voice_hashtags_enabled` and `clients.ig_last_error`. Not applied.
- `lib/creative-lab/voice-traits.ts`, `voice-store.ts`, `voice-fixtures.ts`
- `lib/creative-lab/writer.ts` — voice block after the shape examples, omitted under 8 samples so today's prompt stays byte for byte
- `lib/creative-lab/ig-discovery.ts` — artist captions saved from the Find clips read; promoter own-edge read; nightly refresh of promoter pages read in the last 30 days
- `voice-panel.tsx` is the chip and the 440px / 88% sheet. CLV1–CLV4 mount it. The hashtag switch is on the client form.

## Validation

- [x] `npm test`
- [x] `npm run build`
- [ ] frames:check on CLV1–CLV4 (baselines 42501686368 and 42501694140)

## Notes

- Traits are computed from the samples when they are written. There is no traits table. A promoter read error is `clients.ig_last_error`.
- The hashtag switch is `clients.voice_hashtags_enabled`, named "Hashtags in ad text" on the client form, with "Hashtags in an ad's text link away from the ad." under it. The Lab route does not set it.
- The chip sits after Generate. Dates are Europe/London. An under-floor chip at 393 shows the count ("2 posts"). Pronouns come from the artist row; with none, the sentences say "their" / "they're". The frame clock is 10 Nov 2026 so the 10 Oct read is past 30 days and still labels "Sat 10 Oct".
- With the switch off, a hashtag is rejected at any post count. An @mention is rejected either way. Exemplars keep their line breaks.
- The event page passes `quoteMode`, so the chip mounts there. Caption frames do not pass it, so CL1–CL10 stay without the chip.
- The three `fallbackSentence` lines are returned on the writer result and are not drawn.
- Migration 215 sha256 `846ed37ffaae4109e78493f69cc5c9e32a1ae1556046569e5516bb6c75ab6a71`. Not applied.
- CLV1–CLV4 at 1280 and 393 rewritten from matching Ubuntu runs 42501686368 and 42501694140 (`only=CLV`, head `da9b7bc`).

