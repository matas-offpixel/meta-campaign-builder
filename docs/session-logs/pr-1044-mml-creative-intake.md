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
- [x] `npm test` — node 7217 (7213 pass, 4 skipped, 0 fail), including 17 intake tests. Vitest 8/8. Round 2.

## Notes

Images are probed with sharp on the server. Videos have no pixel probe (`probeAspectFromBuffer` returns other for video), so the measured `videoWidth` / `videoHeight` from the browser is the dimension. A filename never overrides a measured ratio. New creatives keep today's default CTA (`book_now`); when `ENABLE_MULTI_PLACEMENT_ASSETS` is not `"1"`, dual and full still save and the card says Meta will cross-publish one asset.

Round 2:

- B1: Send writes `campaign_plan_asset_routes` only for assets in this intake. An enabled route for any other asset stays enabled.
- B2: Nothing else uploads these pending storage assets. `lib/plan/creative-intake-apply.ts` stores `uploadStatus: "pending"` with no hash or video id, and `lib/meta/creative.ts` skips an asset that has neither. Send now copies the object and posts that copy to `/api/meta/upload-asset` (storage-path JSON, the same route bulk-attach uses). A `creative_asset_channel_ids` hit for the ad account makes no call. A failure stays pending and the error is on the tile. The registry path is never the path the route is allowed to delete.
- S1: Register deletes a path only when it matches `images/mml-<uuid>-…` or `videos/mml-<uuid>-…` and it is not `creative_assets.storage_path`.
- S2: After Meta is launched, an update to an MML creative is a noop with a note. Inserts still go in.
- S3: Unmatch only splits the group. It does not sync the drafts. Send does.
- Migration 193 is unchanged and still unapplied.
