## PR

- **Number:** 206
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/206
- **Branch:** `creator/active-creatives-thumbnail-enrichment`

## Summary

Active-creatives snapshot refresh now enriches the already-picked concept thumbnail before writing cache payloads, replacing Meta's small default thumbnail with preferred/highest-width video thumbnails or full-resolution ad image permalinks while preserving the existing thumbnail when enrichment fails.

## Scope / files

- `lib/reporting/active-creatives-fetch.ts` captures thumbnail enrichment source metadata (`video_id` or image hash) from hydrated Meta creatives.
- `lib/reporting/active-creatives-group.ts` and `lib/reporting/group-creatives.ts` carry the source metadata through the highest-spend thumbnail pick into concept groups.
- `lib/reporting/active-creatives-thumbnail-enrichment.ts` enriches snapshot payload thumbnails via `/{video_id}/thumbnails` and `/{ad_account_id}/adimages`, with per-group try/catch fallback to the original thumbnail.
- `lib/reporting/share-active-creatives.ts` runs enrichment only for the snapshot refresh path that already passes `enrichVideoThumbnails`.
- `components/dashboard/events/event-active-creatives-panel.tsx` keeps the new payload fields intact when wrapping an ungrouped row into a synthetic concept group.
- `lib/reporting/__tests__/active-creatives-thumbnail-enrichment.test.ts` covers preferred video thumbnails, highest-width video thumbnails, static image hash lookups, and API failure fallback.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Scoped ESLint passed for touched files.
- Repo-wide `npm run lint` still fails on pre-existing `main` lint violations outside this PR; no touched-file diagnostics were introduced.
- After merge, bust `active_creatives_snapshots` so cron rewrites cached active-creatives payloads with high-resolution thumbnails.
