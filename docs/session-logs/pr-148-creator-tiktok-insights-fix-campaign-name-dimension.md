## PR

- **Number:** 148
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/148
- **Branch:** `creator/tiktok-insights-fix-campaign-name-dimension`

## Summary

Fixes the live TikTok insights adapter after TikTok rejected `campaign_name` as a `/report/integrated/get/` dimension. The report call now groups only by supported dimensions, enriches campaign names through `/campaign/get/`, and applies the existing event-code matcher against those enriched names.

## Scope / files

- `lib/tiktok/insights.ts` drops `campaign_name` from report dimensions, adds one `/campaign/get/` enrichment call, and falls back to `(unnamed)` if no campaign-name payload is returned.
- `lib/tiktok/__tests__/insights.test.ts` covers enrichment, case-insensitive event-code matching against enriched names, and the no-name fallback path.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`
- [x] `npm run lint` — full repo still reports existing unrelated baseline issues; touched files pass `npx eslint "lib/tiktok/insights.ts" "lib/tiktok/__tests__/insights.test.ts"` with no errors or warnings.

## Notes

- `TIKTOK_CHUNK_CONCURRENCY = 1` remains intact. Campaign-name enrichment is intentionally one `/campaign/get/` call after aggregation, not a new chunked loop.
- Matching remains the reporting-layer convention: bare `event_code`, case-insensitive substring, applied to enriched campaign names when TikTok returns them.
