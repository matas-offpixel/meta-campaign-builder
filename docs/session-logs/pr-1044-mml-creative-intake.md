# Session log

## PR

- **Number:** 1044
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1044
- **Branch:** `cursor/mml-creative-intake`

## Summary

MML section ② takes every image and video once, sorts them by measured pixels, and lets Matas match 2–3 of the same kind into one Meta creative. Send writes those creatives into the plan's linked Meta draft and routes 9:16 videos into the TikTok draft through the existing asset-routing path. Drop does not call Meta's upload-asset route. Migration 193 is in the PR and is not applied.

## Scope / files

- `components/plan/mml-creative-intake.tsx` — drop zone, four columns, Match, Send
- `app/api/plan/[id]/creative-intake/route.ts`
- `lib/plan/creative-intake.ts`, `creative-intake-apply.ts`, `creative-intake-db.ts`, `creative-intake-server.ts`
- `supabase/migrations/193_mml_creative_intake.sql` — unapplied
- `lib/tiktok-wizard/campaign-asset-upload.ts` — export the existing campaign-assets upload
- `components/plan/plan-workspace.tsx`, `lib/plan/mml-sections.ts`

## Validation

- [x] `npx tsc --noEmit` (no errors in the M2 files)
- [x] `npm run build` compiles. The local typecheck then fails in gitignored `scripts/out/gds-groups.mts`, which CI does not have.
- [x] `npm test` — node 7213 (7209 pass, 4 skipped, 0 fail), including 13 intake tests. Vitest 8/8.

## Notes

Images are probed with sharp on the server. Videos have no pixel probe (`probeAspectFromBuffer` returns other for video), so the measured `videoWidth` / `videoHeight` from the browser is the dimension. A filename never overrides a measured ratio. New creatives keep today's default CTA (`book_now`); when `ENABLE_MULTI_PLACEMENT_ASSETS` is not `"1"`, dual and full still save and the card says Meta will cross-publish one asset.
