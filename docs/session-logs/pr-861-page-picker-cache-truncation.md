# Session log — wizard page picker no longer drops Parable

## PR

- **Number:** 861
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/861
- **Branch:** `cursor/page-picker-cache-truncation`

## Summary

The wizard Facebook Page picker never read `/{ad-account}/promote_pages` —
the list Meta validates `object_story_spec.page_id` against. That hid
Parable on the Louder account while Louder Events still appeared. Merge
promote_pages (deduped), follow Graph cursors instead of a silent 200-item
stop, and never cache a failure as a successful page list.

## Scope / files

- `lib/meta/pages-list-response.ts` — promote merge, cursor follow, error TTL
- `lib/meta/client.ts` — `fetchPagedPageEdge` + `fetchPromotePages`
- `app/api/meta/pages/route.ts`
- `lib/hooks/useMeta.ts`
- `components/steps/creatives.tsx` — retry copy
- `lib/meta/__tests__/pages-list-response.test.ts`

## Validation

- [x] eslint on changed files: 0 new errors (pre-existing useMeta setState-in-effect / creatives img warnings)
- [x] `npm run build` — compiled + TS finished
- [x] `npm test` — 4586 / 4583 pass / 3 skipped / 0 fail (16 in pages-list-response.test.ts)

## Notes

Mechanism that hid Parable: **source mismatch (c)**, confirmed with a
Louder-shaped fixture (27 promote_pages including Parable + Louder Events;
owned/personal only Louder Events). Not a 200-page truncation of that
account. Pagination and error-TTL are hardening for the other audit holes.
