# Session log — video views source validation + multi-URL pixel

## PR

- **Number:** 313
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/313
- **Branch:** `fix/audiences-video-views-pixel`

## Summary

Fixes “Video views … source ID is required” when campaigns were selected but `sourceId` was blank while `videoIds` carried creatives: resolution prefers `video_ids` from `source_meta`, with a clear error when campaigns are chosen but no videos are selected. Website pixel audiences persist `url_contains` as `string[]`, coerce legacy DB strings on read, build Meta rules with OR’d `i_contains` URL predicates when multiple fragments are set, and omit URL filters entirely when none are provided so the audience matches all URLs for the pixel event.

## Scope / files

- `lib/audiences/video-views-source.ts`, `lib/audiences/api.ts`
- `lib/audiences/pixel-url-contains.ts`, `lib/audiences/source-meta-read.ts`, `lib/db/meta-custom-audiences.ts`
- `lib/meta/audience-payload.ts`
- `components/audiences/source-picker.tsx`, `app/audiences/.../audience-create-form.tsx`, `lib/types/audience.ts`
- `lib/audiences/funnel-presets.ts` — mid-funnel ViewContent preset without fake empty URL string

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] ESLint (touched paths)
