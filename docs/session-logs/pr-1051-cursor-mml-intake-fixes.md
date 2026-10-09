# Session log

## PR

- **Number:** 1051
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1051
- **Branch:** `cursor/mml-intake-fixes`

## Summary

R0 only. A deduped intake file whose registry row is still `other` now takes the ratio this upload measured, and that ratio is written back onto `creative_assets` only from `other` or null. Send copies the file with the service role, because the session client cannot read `campaign-assets` and Storage answered `Object not found`. Send shows `Uploading 1 of 3…` and a result per creative. The fact check folds a trailing `'s` / `’s`, and `Experience` is no longer treated as a name.

## Scope / files

- `lib/plan/creative-intake.ts`, `lib/plan/creative-intake-server.ts`, `lib/creatives/asset-registry.ts` — dedupe bucket
- `lib/plan/creative-intake-meta.ts` — service-role copy, then the upload route
- `components/plan/mml-creative-intake.tsx`, `app/api/plan/[id]/creative-intake/route.ts` — progress and results
- `lib/plan/copy-facts.ts` — possessives and `Experience`
- No layout change, no launch path, no `lib/meta` edit, no orchestrator change

## Object not found

The Folamour draft stored `error: "Object not found"` on Grid.jpg and Story.jpg, with no `Failed to access stored file:` prefix. That string is the session client's `storage.copy` error, not `createSignedUrl` in `lib/meta/upload-asset-handler.ts`.

The copy asked bucket `campaign-assets` for `images/mml-201cffc4-…-grid.jpg` and `images/mml-c41ac78a-…-story.jpg`. Both objects are in the bucket. The only policy on that bucket is INSERT for authenticated users, so a session-client read is hidden as `Object not found`. The `mml-…-meta-upload` copy was never created, and it was not deleted before Meta read it.

The copy now runs at `lib/plan/creative-intake-meta.ts:37` on the service-role client (`lib/plan/creative-intake-server.ts` `serviceRoleStorage`). The copy is removed after the upload call returns.

## Validation

- [x] `npx tsc --noEmit` — 346 errors, none in touched files
- [x] `npm run build`
- [x] `npm test` — node 7283 tests, 7279 pass, 0 fail, 4 skipped; vitest 8/8
- [x] ESLint on touched files — no new errors

## Tests added

- Dedupe of an `other` row with 1080×1920 lands in 9:16; a 4:5 row is not replaced; null upgrades
- `upgradeRegisteredAspect` writes only where the row is `other` or null
- Two stored images produce Meta hashes; the upload route is not called when copy returns `Object not found`
- `Folamour's` and `Newcastle's` pass when the name is on the page; `Experience` is not a fact
- Register posts `video.videoWidth` / `video.videoHeight` for every video
- Progress line `Uploading 1 of 3…` and the per-group result lines

## Notes

R1 (wizard shell) is not in this branch. Videos are still measured in the browser; the server does not probe video pixels. The register body already sent those dimensions, including on a dedupe.
