# Session log — creative create errors are not all app mode (task #95)

## PR

- **Number:** 994
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/994
- **Branch:** `cursor/creative-error-not-app-mode`

## Summary

Launch Phase 3 used to label every creative-create failure with Meta code 200
(the generic Permissions error), or any message containing "development", as
"your Meta app is in Development mode". It then showed the red app-mode
preflight warning and the Review banner. The app has been Live for months, so
operators got the wrong fix for what was almost always a missing token grant on
the creative's Page or Instagram account. Phase 3 now calls one classifier,
`classifyCreativeCreateError`, and permission failures get their own banner,
which names the assets and links to `/business-managers`.

## Scope / files

- `lib/meta/launch-error-classify.ts`: adds `classifyCreativeCreateError(err, identity?)`, with kinds `app_mode`, `permission`, `website_url_required`, `archived_campaign` and `other`.
  - `app_mode` needs Meta's explicit wording, matching `/app (that )?(is )?(in )?development mode|not (in )?live mode|switch (the )?app to live/i`. The spec's regex got an optional `that` so Meta's own subcode 1885183 wording ("created by an app that is in development mode") still counts. Code 200 on its own is not app mode. The `skippedReason` stays `app_mode_blocked`.
  - `permission` covers code 200, code 10, subcode 1349125 and subcode 1349131. The `skippedReason` is `permission`, and the message names `Page {pageId}` / `Instagram account {igId}` and points at `/business-managers`.
  - 2061015 and 1487866 go through the existing `websiteUrlRequiredMessage` and `archivedCampaignMessage` helpers, with their wording unchanged.
  - `other` is the raw message with `code=` / `subcode=` / `detail` / `trace` appended, the same parts `formatMetaError` uses, with no advice.
- `lib/meta/launch-error-classify.ts`: adds `creativeFailureBanners(summary)`. This pure function holds the banner copy shared by the route's preflight warning and the Review card. The app-mode titles are unchanged.
- `app/api/meta/launch-campaign/route.ts`: the Phase 3 creative catch calls the classifier. It passes the Page id and the Instagram id that was actually sent in the payload (`instagram_user_id`). The `app_mode_blocked` preflight banner is unchanged and now only counts real app-mode failures. There is a new parallel red `permission` preflight warning. No Meta write calls were added or removed, and the payload is unchanged.
- `lib/types.ts`: `LaunchSummary.creativesFailed[]` gains optional `pageId` / `instagramAccountId`. They are set only when `skippedReason === "permission"`, so they travel on the same channel that already carries `app_mode_blocked`.
- `components/steps/review-launch.tsx`: the event log labels permission failures as "Creative blocked — launch token lacks permission" and counts them as failed, not skipped. There is a new permission banner beside the app-mode banner, with an "Open Business Managers" link to `/business-managers`. Both banners are gated by `creativeFailureBanners`.
- `lib/meta/__tests__/launch-error-classify.test.ts`: 13 new tests.

## Validation

- [x] `npx tsc --noEmit`: 342 errors before and after, all pre-existing in test files under `lib/tiktok/**` and elsewhere. None are in touched files.
- [x] `npm run build`: exit 0, compiled plus TypeScript passed. Locally, Turbopack rejects the worktree's symlinked `node_modules`, so the build ran with a bind mount of the same directory.
- [x] `npm test`: 6388 tests, 6384 pass, 0 fail, 4 skipped. `launch-error-classify.test.ts` is 23/23. The #969 write-set guard in `lib/plan/__tests__/drawer.test.ts` passes.
- [x] `eslint` on touched files: 0 errors (warnings are pre-existing unused imports).

## Notes

- The banner assertion covers three permission failures and zero app-mode failures. `appMode` is `null`, and the permission title is `3 creatives blocked — launch token lacks permission`. The body is `Meta refused these creatives because the launch token lacks a permission on Page 111, Instagram account 999 and Page 222. Grant access to those assets in Business Managers, then relaunch.`
- Nobody has clicked through the React banner. Only the pure copy function is tested.
- The Phase 4 ad-create catch still calls `websiteUrlRequiredMessage` directly and is out of scope.
- No migration. `lib/meta/creative.ts` is untouched.
