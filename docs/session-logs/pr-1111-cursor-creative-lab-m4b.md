# Session log

## PR

- **Number:** 1111
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1111
- **Branch:** `cursor/creative-lab-m4b`

## Summary

Import an artist's own Instagram clips, reject burned-in text, crop every clip to 9:16, and show renders as rows. Clearance is not required. Migration 210 is written and not applied.

## Scope / files

- `supabase/migrations/210_creative_lab_m4b.sql`
- `lib/creative-lab/ig-import.ts`, `ig-discovery.ts`, `overlay-check.ts`, `overlay-run.ts`, `ig-auto.ts`, `clip-sync.ts`
- `src/remotion/caption-style/profile.ts`, `src/remotion/compositions/FrameSheet.tsx`
- Candidate tile, crop picker, render rows in `components/dashboard/events/creative-lab/`
- Frames CL7–CL10

## Validation

- [x] `npm test`
- [x] `npm run build`

## Notes

- Fixture candidate lengths (▶ 0:18 and the rest) are drawn for the frames only. Instagram's listing does not return a duration, and none is stored.
- The crop picker's six frames are six video elements of the clip file, seeked locally. Opening the picker does not call Lambda.
- A minute on a render row is shown only when a finished render has a measured `render_ms`. With no average, the row says Rendering.
- The Lambda still is one invocation at 2048 MB in eu-west-2. Its `estimatedPrice` is the cost of that call. The vision call is one `claude-sonnet-4-6` forced tool with the sheet and the thumbnail.
- The first real import is Add on production after this merges and migration 210 is applied.
