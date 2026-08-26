# Session log — asset registry + routing matrix (M.2 / CR.1)

## PR

- **Number:** 862
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/862
- **Branch:** `cursor/asset-registry-routing-matrix`

## Summary

Deterministic creative identity at Meta upload (sha256 + byte size), with
per-scope channel ids so an asset is uploaded to a given Meta ad account or
TikTok advertiser at most once. The plan page gains a routing matrix between
Step 1 and Step 2; TikTok prepare fans out routed videos through the existing
transport. Images cannot reach TikTok. Historical backfill is a named follow-up.

## Scope / files

- `supabase/migrations/161_creative_asset_registry.sql` — file only, not applied
- `lib/creatives/asset-registry.ts`, `register-upload.ts` (does not replace the Remotion provider registry)
- `lib/plan/asset-routing*.ts`
- `lib/tiktok/upload-from-registry.ts` — existing transport, no source delete
- `app/api/meta/upload-asset/route.ts` — additive registration
- `app/api/plan/[id]/asset-routes/route.ts`
- `app/api/plan/[id]/prepare-draft/route.ts`
- `components/plan/asset-routing-matrix.tsx`
- Tests: `lib/creatives/__tests__/asset-registry.test.ts`, `lib/plan/__tests__/asset-routing.test.ts`

## Validation

- [x] eslint on changed files — 0 errors
- [x] `npm run build` — compiled + TypeScript finished
- [x] `npm test` — 4602 / 4599 pass / 3 skipped / 0 fail

## Notes

Mechanism: fuse existing products. No new upload surface. No Meta launch-path
change. Killswitches untouched.

Named follow-ups: historical backfill; TikTok image ads; Meta-side routing of
registry assets into other Meta campaigns.
