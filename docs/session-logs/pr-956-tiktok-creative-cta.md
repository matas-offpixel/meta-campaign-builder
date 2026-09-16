# Session log — TikTok creative CTA

## PR

- **Number:** 956
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/956
- **Branch:** `cursor/tiktok-creative-cta`

## Summary

Imported creatives keep `cta: null`. The Step 5 dropdown belonged to the
add-a-creative form, so Matas's Learn more / Book now clicks never reached
the ten rows that launch. The writer omits `call_to_action` when CTA is
null. Preflight now blocks that for TRAFFIC / CONVERSIONS / LEAD_GENERATION
(portal 1739403070695426). Each existing row has a CTA select that persists
on change. Import reports when TikTok sent no CTA. The fake Smart+
linkage input is gone.

## Scope / files

- `lib/tiktok-wizard/creative-cta.ts` — documented enum, patch, persist-on-change
- `components/tiktok-wizard/steps/creatives.tsx` — per-row CTA, set-all
- `lib/tiktok/write/preflight.ts` — missing-CTA block
- `lib/tiktok/import/map.ts` + `types.ts` — dropped `call_to_action` when unset
- `components/tiktok-wizard/steps/campaign-setup.tsx` — Smart+ sentence

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 6027 pass, 0 fail, 4 skipped

## Notes

- Request ids `20260917044200796424C01973C5454A13` and
  `202609170442501508C62D8C051FE55834` both failed `/ad/create/` on a
  VIDEO_REFERENCE (`video_id` present), `promotion_type: WEBSITE`. The
  SPARK-only hypothesis is out. The identity logger does not record
  `call_to_action`, so the omitted key is inferred from `cta: null` plus
  `if (input.creative.cta)`.
- Enum: OpenAPI CallToAction `1807533165224961`. Not BUY_TICKETS / DOWNLOAD.
