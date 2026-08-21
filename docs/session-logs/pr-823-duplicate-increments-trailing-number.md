# Session log

## PR

- **Number:** 823
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/823
- **Branch:** `cursor/duplicate-increments-trailing-number`

## Summary

Duplicating an ad or ad set now increments the trailing number (next unused in scope) instead of appending " (copy)". Names without a trailing number get `" 2"`. The East End Dubs mode-flip suffixes (` – Strict` / ` – Adv+`) are unchanged; the mode-unchanged fallback still produces a distinct name.

## Scope / files

- `lib/duplicate-name.ts` — shared helper (Meta ads, Meta ad sets; TikTok library can import later)
- `lib/__tests__/duplicate-name.test.ts`
- `lib/wizard/adset-suggestions.ts` + tests
- `components/steps/creatives.tsx`

## Validation

- [x] `npm run build`
- [x] `npm test` — 4130 tests, 4114 pass, 13 pre-existing failures, 3 skipped

## Notes

- Years like "Ibiza 2026" increment to 2027 on purpose — documented in the helper and a test. No silent magnitude/year heuristic.
- Did not wire TikTok campaign-library duplicate in this PR; the helper is exported from `lib/duplicate-name.ts` so that branch can call it.
