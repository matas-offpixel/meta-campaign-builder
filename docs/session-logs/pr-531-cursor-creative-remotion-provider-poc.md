# Session log — Remotion creative provider POC (Vercel-only)

## PR

- **Number:** 531
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/531
- **Branch:** `cursor/creative/remotion-provider-poc`

## Summary

Adds Remotion as a fifth `CreativeProvider` behind `FEATURE_REMOTION`, with a hardcoded 1080×1080 city-static composition, build-time bundling, synchronous in-process `renderStill`, Supabase Storage upload to `campaign-assets`, and an admin render-test page + API route for manual smoke testing.

## Scope / files

- `lib/creatives/types.ts` — `remotion` provider name + `isRemotionEnabled()`
- `lib/creatives/registry.ts` — registry entry
- `lib/creatives/remotion/provider.ts` — provider implementation
- `lib/creatives/remotion/provider.test.ts` — gating + validation tests
- `src/remotion/index.tsx` + `src/remotion/compositions/FourTfCityStatic.tsx` — composition
- `scripts/bundle-remotion.ts` — pre-build bundle (Remotion cannot bundle inside Next API routes)
- `app/api/admin/remotion/render/route.ts` — admin render API
- `app/admin/render-test/page.tsx` + `components/admin/render-test-form.tsx` — smoke-test UI
- `next.config.ts` — `serverExternalPackages` for Remotion
- `package.json` — Remotion deps + `bundle-remotion` / `prebuild`

## Validation

- [x] `npm run bundle-remotion`
- [x] `node --test lib/creatives/remotion/provider.test.ts` — 4/4 pass
- [x] `npm run lint` (touched files)
- [x] `npm run build` — exit 0
- [x] Offline render smoke test — 49,693 byte PNG in ~195ms (after Chrome download)
- [ ] Local `/admin/render-test` with `FEATURE_REMOTION=1` + signed URL (manual — requires login session)

## Notes

- No canonical 4theFans brand colour in repo — composition uses `#0f172a` fallback; logo placeholder text `4TF` (no `public/4tf-logo.*`).
- Runtime `bundle()` inside API routes is unsupported per Remotion Next.js docs; bundle runs via `prebuild` instead of module-load cache.
- `FEATURE_REMOTION` defaults to off — flip only after Matas validates POC.
