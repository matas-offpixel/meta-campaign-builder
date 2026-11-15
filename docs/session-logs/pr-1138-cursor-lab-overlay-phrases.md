# Session log

## PR

- **Number:** 1138
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1138
- **Branch:** `cursor/lab-overlay-phrases`

## Summary

A venue name that contains "&" was split on the overlay because the protected-phrase match dropped the ampersand, so "Circuit & Engine Rooms" never became one atom. "& more" now joins the name before it. The writer is told to put the lineup, the venue and the date each on its own line; the wrapper is still the guarantee.

## Scope / files

- `lib/creative-lab/caption-facts.ts`
- `lib/creative-lab/writer.ts`
- `lib/creative-lab/__tests__/caption-facts.test.ts`

## Validation

- [x] `npm test`
- [ ] `npm run build` — CI
- [ ] `frames:check` — no fixture reflow in the lab frame line test

## Notes

Migration: none. Do not add the design-pass label.

`tokenKey` strips a punctuation-only token, so "&" was missing from the protected phrase and the four caption tokens never lined up with the three name keys.

Case 3 stores "at" on its own line. "at Circuit & Engine Rooms" is 25 characters, and the long size is 24. The venue stays one atom.
