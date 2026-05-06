# Session log — thread/fix-audiences-meta-four-subtypes

## PR

- **Number:** 315
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/315
- **Branch:** `thread/fix-audiences-meta-four-subtypes`

## Summary

Corrects Meta custom audience payloads for website pixel (scheme-stripped URL fragments, AND event + OR URL group under `rule.inclusions`), preserves pixel URL textarea multi-line editing so Enter leaves a blank second line, improves video campaign picker auto-select-all after fetch and thumbnail/label fallbacks, and adds unit tests.

## Scope / files

- `lib/meta/audience-payload.ts`, `lib/audiences/pixel-url-contains.ts`
- `components/audiences/source-picker.tsx`
- `lib/audiences/video-picker-auto-select.ts`
- `lib/meta/__tests__/audience-write.test.ts`
- `lib/audiences/__tests__/pixel-url-scheme.test.ts`, `url-textarea.test.ts`, `video-source-picker.test.ts`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] ESLint on touched audience paths

## Notes

PR description cites prod Meta API errors (#2654, #100, and related) for the four subtypes. Manual Ads Manager smoke recommended before broad rollout.
