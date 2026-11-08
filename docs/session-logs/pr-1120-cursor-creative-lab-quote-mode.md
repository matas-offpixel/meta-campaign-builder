# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** 1120
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1120
- **Branch:** `cursor/creative-lab-quote-mode`

## Summary

Quote mode stores an artist's own words as the native text. The generator stops calling the writer. A quote is artist-voice, so it stays held until the artist is cleared, and the caption validator's scarcity, name, date and crowd checks still apply. Rule 13 is a separate profile from the quote style.

## Scope / files

- `supabase/migrations/214_creative_lab_quote_mode.sql` (written, not applied)
- `lib/creative-lab/quote.ts`, writer guard, propose gate, render mode
- `src/remotion/caption-style/quote-v1.json` (v1.json untouched)
- Captions generator mode switch, quote feed post, CLQ frames

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [ ] `npm test` (when applicable)

## Notes

`quote_weight` and `artist_id` are extra columns. The Instagram candidate table has no caption text, so "A post" can only fill the box from a caption already on the row. Enzo Siragusa has no listed posts.
