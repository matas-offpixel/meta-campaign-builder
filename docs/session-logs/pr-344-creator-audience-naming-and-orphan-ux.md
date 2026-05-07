## PR

- **Number:** 344
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/344
- **Branch:** `creator/audience-naming-and-orphan-ux`

## Summary

Adds Matas-style human-readable audience name suggestions (`[event_code|client_slug] … retention`) with multi-campaign video views resolving the most common bracketed campaign prefix plus `+N` for other campaigns. Improves the video source picker empty state when every fetched video is orphan-filtered (no Page link), with copy explaining next steps and a control to refocus campaign search.

## Scope / files

- `lib/audiences/naming.ts` — `extractEventCode`, `mostCommonEventCode`, `buildAudienceName`
- `app/(dashboard)/audiences/[clientId]/new/audience-create-form.tsx` — wire naming + bundle placeholders / submit fallback
- `components/audiences/source-picker.tsx` — orphan-only empty state + focus link
- `lib/audiences/__tests__/naming.test.ts`, `audience-create-naming.integration.test.ts`

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] ESLint on touched files
