# Session log

## PR

- **Number:** 914
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/914
- **Branch:** `cursor/plan-resume-honest-counts`

## Summary

#913's Resume walk is right; two error paths invented a count. Unreadable lists are their own state (`couldn't read its ad sets` / `couldn't read the ads on 2 of them`) — no `n of m` unless both were counted. ARCHIVED / DELETED / WITH_ISSUES are skipped and left out of the total. An already-ACTIVE tree says `already running`. The dead `campaignFailed` formatter branch is gone. `ENABLE_PLAN_FANOUT` stays unset.

## Scope / files

- `lib/plan/resume.ts` — `adSetsUnread` / `adSetsWithUnreadAds`, `isResumable`, already-running sentence
- `lib/plan/__tests__/resume.test.ts` — unread catches, deleted/archived skip, already running

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5373 pass, 4 skipped)
- [ ] CI `frames:check` (Ubuntu raster). Local macOS diffs are height/raster; no framed sentence changed.

## Notes

Not a fix here: `app/api/meta/launch-campaign/route.ts` computes top-level `adsCreated` as `creativesCreated.reduce(...)` (~:4023). The multi-campaign attach path counts into `campaignAttachResults[].adsCreated` instead (~:4432). Top-level `adsCreated` is therefore 0 for a pure attach-mode launch, and #913's `interpretMetaLaunchSummary` would call that launch `failed`. Plan fan-out always creates a fresh campaign, so this is not live — but if plan launch ever gains attach mode, guard 2 inverts.

Do not set `ENABLE_PLAN_FANOUT`.
