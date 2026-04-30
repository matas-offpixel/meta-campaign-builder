## PR

- **Number:** 205
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/205
- **Branch:** `creator/active-creatives-modal-thumbnail-consistency`

## Summary

Active-creatives concept groups now pick one deterministic group-level thumbnail from the highest-spend ad with a resolved thumbnail, and both card and modal thumbnail-only render paths consume that same picked URL so Dynamic / Advantage+ concepts no longer show different posters between card and expanded modal.

## Scope / files

- `lib/reporting/active-creatives-group.ts` tracks the highest-spend thumbnail ad within each creative group and exposes `thumbnail_url`, `thumbnail_ad_id`, and `thumbnail_spend`.
- `lib/reporting/group-creatives.ts` carries the deterministic thumbnail pick through concept grouping via `representative_thumbnail` and `representative_thumbnail_ad_id`.
- `lib/reporting/active-creatives-thumbnail.ts` centralizes modal image resolution so low-res fallback previews prefer the group-level thumbnail.
- `components/share/share-creative-preview-modal.tsx` and `components/dashboard/events/creative-preview-modal.tsx` use the shared modal thumbnail resolver.
- `components/dashboard/events/event-active-creatives-panel.tsx` preserves the thumbnail ad id when wrapping ungrouped rows.
- `lib/reporting/__tests__/active-creatives-thumbnail.test.ts` covers highest-spend thumbnail selection, null-top-spender fallback, and single-ad concepts.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Scoped ESLint passed for touched files.
- Repo-wide `npm run lint` still fails on pre-existing `main` lint violations outside this PR; no touched-file diagnostics were introduced.
