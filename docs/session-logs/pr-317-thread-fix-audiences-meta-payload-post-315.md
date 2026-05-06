# Session log — thread/fix-audiences-meta-payload-post-315

## PR

- **Number:** 317
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/317
- **Branch:** `thread/fix-audiences-meta-payload-post-315`

## Summary

Aligns Meta Marketing API custom audience rule JSON with Ads Manager exports: leaf predicates use operator `"="` (not `eq`) to avoid subcode **1870053**, website pixel matches the required AND/OR nest with scheme-stripped URL values, video audiences use `subtype: "VIDEO"`, and page engagement / follower event strings match reverse-engineered Ads Manager rule previews dated **2026-05-06**.

## Scope / files

- `lib/meta/audience-payload.ts`
- `lib/meta/__tests__/audience-write.test.ts`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` on touched paths

## Live Meta verification (production)

**Not verified in this session.** Do **not** squash-merge until all four succeed against production Meta (same gates as the PR description):

| Gate | Status |
|------|--------|
| `website_pixel` (e.g. Back Of House Festival) → DB `status=ready` | ⏳ pending |
| `video_views` (single video, no 403) → `status=ready` | ⏳ pending |
| `page_engagement_fb` → `status=ready` | ⏳ pending |
| `page_engagement_ig` → `status=ready` | ⏳ pending |

When done, replace this section with:

`Verified live in production: ✅ website_pixel | ✅ video_views | ✅ page_engagement_fb | ✅ page_engagement_ig`

—or list failing subtype with exact Graph `error_subcode` / `status_error` text.

## Notes

Follow-up PR **#315** shipped structure tests; this PR applies operator + subtype + event token corrections pending human Ads Manager confirmation for IG followers vs FB if Meta diverges on `page_like`.
