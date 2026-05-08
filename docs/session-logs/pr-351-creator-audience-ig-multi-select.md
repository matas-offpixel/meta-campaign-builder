# Session log — PR #351

## PR

- **Number:** 351
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/351
- **Branch:** `creator/audience-ig-multi-select`

## Summary

Replaced the single-select `Combobox` in `IgSourcePicker` with the same searchable multi-select checkbox list used by `PageSourcePicker`. Users can now attach multiple IG accounts to a single engagement audience (e.g. Junction 2's Mall Grab + Scarlett O'Malley). The `buildMetaCustomAudiencePayload` engagement path already emits one `event_sources` rule entry per page ID — no payload changes needed.

## Scope / files

- `components/audiences/source-picker.tsx` — `IgSourcePicker` rewritten; unused `Combobox` import removed
- `lib/meta/__tests__/audience-write.test.ts` — new multi-page IG engagement test

## Validation

- [x] `npm run build` — clean
- [x] `npm test` — 796/796 pass
- [x] `npx eslint` (scoped) — clean
