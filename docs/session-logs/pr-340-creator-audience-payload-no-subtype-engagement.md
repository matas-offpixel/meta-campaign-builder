# Session log — PR #340

## PR

- **Number:** 340
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/340
- **Branch:** `creator/audience-payload-no-subtype-engagement`

## Summary

Removed the deprecated `subtype` and `retention_days` top-level fields from engagement/follower audience POST payloads. Meta deprecated `subtype` for engagement audiences in Sep 2018; including it triggered the misleading `#2654 Invalid event name` error that plagued every audience-builder iteration since PR #313. Also reverted `event_sources.id` to string (matching the already-working `createEngagementAudience()` path in `lib/meta/client.ts`). Video views and pixel paths are unchanged — their `subtype` values remain required.

## Scope / files

- `lib/meta/audience-payload.ts` — removed `retention_days` from `base`; removed `subtype: "ENGAGEMENT"` from engagement/follower return; `event_sources.id` now string; comment updated to document root cause
- `lib/meta/__tests__/audience-write.test.ts` — engagement/follower tests now assert no `subtype`, no `retention_days`, and string `event_sources.id`

## Validation

- [x] `npm run build` — clean
- [x] `npm test` — 721/721 pass
- [x] `npx eslint lib/meta/audience-payload.ts lib/meta/__tests__/audience-write.test.ts` — clean

## Notes

Root cause of every `#2654` error across PRs #313 / #315 / #317 / #328 / #329 / #336 / #337. The signal was that `lib/meta/client.ts createEngagementAudience()` (used by the campaign creator wizard) has always worked — it sends only `{name, rule, prefill}`. After deploy, re-queue and retry all FB/IG engagement and follower audiences.
