# Session log

## PR

- **Number:** 833
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/833
- **Branch:** `cursor/tiktok-stale-keyword-ids`

## Summary

Block launches whose saved `interest_keyword_ids` TikTok no longer indexes, instead of failing at `/adgroup/create/` with 40002. Retire the unused manual identity ID/name inputs; keep the type select only when TikTok returns an identity with no `identity_type`.

## Scope / files

- `lib/tiktok/audience.ts` — `fetchTikTokInterestKeywordsByIds` (`/tool/interest_keyword/get/`, fallback `/tool/hashtag/get/`)
- `lib/tiktok/write/interest-keywords.ts` — hydrate + 14-day stale helper
- `lib/tiktok/write/launch.ts` — hydrate before preflight
- `lib/tiktok/write/preflight.ts` — `interest-keyword-retired` blocker
- `lib/tiktok/write/error-classify.ts` — 40002 additional-interest matcher
- `lib/types/tiktok-draft.ts` — `resolvedAt`; drop `MANUAL` identity type
- Audiences + Review amber note; Account setup type-only repair
- `lib/tiktok-wizard/validation.ts` — drop `identity-manual`

## Validation

- [x] Targeted TikTok tests (audience, preflight, hydrate, error-classify, validation, mapping) — 92 pass
- [ ] `npm test` / CI

## Notes

- Hydrate does not drop dead ids from the draft. Preflight names the group and chips.
- Missing `resolvedAt` counts as stale so existing drafts surface the 14-day note.
