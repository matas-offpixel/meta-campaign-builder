# Session log — BM Asset Sync: fix grant endpoint + false-success revalidation bug

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cc/ops/bm-grant-endpoint-fix`

## Summary

Fixes two bugs in the Business Manager Asset Sync tool (PR #706) that made
every live "Grant all missing" / "Grant me access" click against LWE's
Business Manager fail with Meta's "Unknown path components" error while the
UI still reported success.

## Scope / files

**Bug 1 — wrong Meta grant endpoint**

- `lib/meta/business-manager.ts` — `grantUserPagePermission` posted to
  `/{bizId}/pages/{pageId}/user_permissions` with a `role` field. That
  three-segment path is **not a real Graph API edge** — Meta deprecated the
  old `{business-id}/userpermissions` scheme in Graph API v2.11 (confirmed
  against current developer docs), and it never composed with `/pages/`.
  `bizId` was already present in the path before this fix; the bug was the
  endpoint shape itself, not a missing path segment. The correct, current
  edge is `POST /{pageId}/assigned_users` with `user` + a `tasks` array (no
  business id in the path).
- `lib/meta/business-manager-grant-request.ts` (new) — pure
  `buildGrantUserPagePermissionRequest(pageId, targetUserId, role)` +
  `ROLE_TO_META_TASKS` map (ADVERTISER→ADVERTISE, ANALYST→ANALYZE,
  EDITOR→CREATE_CONTENT, ADMIN→MANAGE). Split out from
  `business-manager.ts` (which imports `client.ts`'s parameter-property
  `MetaApiError` class — unsupported by Node's `--experimental-strip-types`
  test runner) so the request-building logic is unit-testable, same
  rationale as the existing `error-classify.ts` split.
- `lib/meta/__tests__/business-manager-grant-url.test.ts` (new) — byte-diffs
  the built path (`/{pageId}/assigned_users`, asserts it does NOT contain
  `/user_permissions` or `/pages/`) and the JSON body (`{user, tasks}`, no
  `role` field) for all 4 `BMPageRole` values. Regression guard against this
  exact mistake recurring.

**Bug 2 — false "success" after a fully-failed grant run**

- The dashboard already called `router.refresh()` after every grant action
  (this was implemented correctly in #706) — so "doesn't revalidate" was a
  symptom, not the root cause. The actual defect: `grant-all/route.ts`
  computed `ok: !result.tokenExpired`, which is `true` even when **every**
  individual grant fails (e.g. Bug 1's error) since `tokenExpired` is only
  set on Meta subcode 190. The UI showed "Missing access resolved" while
  `missing_access_count` never moved, because nothing had actually
  succeeded in Meta.
- `lib/bm/types.ts` — added `isFullGrantSuccess(result)` (requires
  `!tokenExpired && failed === 0`) and `describeGrantResult(result)` (human
  summary: full success / partial failure with first error / token expired
  / no-op), shared by both grant routes and the dashboard so the "ok" signal
  and the displayed text always agree with the real counts.
- `app/api/business-managers/[bizId]/pages/grant-all/route.ts` and
  `.../[pageId]/grant/route.ts` — `ok` now uses `isFullGrantSuccess`; both
  return `error: describeGrantResult(result)` when not fully successful.
- `components/admin/business-managers/bm-dashboard.tsx` — success notice now
  renders `describeGrantResult(result)` (real granted/attempted/failed
  counts) instead of a static "Access granted." string, so a partial or
  zero-success run is never displayed as a flat success. `router.refresh()`
  retained (was already correct).

## Validation

- [x] `npm run build` — exit 0.
- [x] `npm test` — new regression test passes (2/2); pre-existing unrelated
      failures on `main` (14, confirmed via `git stash` diff — same count
      with and without this change) untouched.
- [x] `npx eslint` on all touched/new files — clean.
- [ ] Manual smoke test — Matas to re-run "Grant all missing" against LWE
      (5 pages) post-deploy; expect 0 missing on next scan and 5
      `bm_page_access_events` rows with `action='granted'`.

## Notes

- Verified the corrected endpoint (`/{page_id}/assigned_users`, `tasks`
  array) against Meta's current Graph API reference docs
  (`developers.facebook.com/docs/graph-api/reference/page/assigned_users`)
  — not just re-adding `business_id` to the old path, which was already
  present and would not have fixed the live failure.
- `bizId` is kept as a `grantUserPagePermission` parameter (log-only) for
  audit/log correlation even though Meta's `assigned_users` edge itself
  takes no business id in the path.
