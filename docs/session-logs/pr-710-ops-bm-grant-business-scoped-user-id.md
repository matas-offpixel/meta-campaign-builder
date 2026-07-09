# Session log — BM Asset Sync: resolve business-scoped user id for grants

## PR

- **Number:** 710
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/710
- **Branch:** `cc/ops/bm-grant-business-scoped-user-id`

## Summary

Third fix in the BM grant chain (#708 → #709 → this). PR #709 fixed the
request body shape (`business` + `user` + `tasks`), but live grants against
LWE's Business Manager (741799859254067) still failed — Meta subcode
1752100 "User is not business-scoped". Root cause: `getMetaUserId`
(`GET /me?fields=id`) returns Matas's **Facebook-level** user id. Meta's
`POST /{page_id}/assigned_users` edge requires a **business-scoped** user
id — a distinct alias per Business Manager he belongs to — for the `user`
field.

## Scope / files

- `lib/meta/business-scoped-user-id.ts` (new) — pure matching helpers
  `pickBusinessScopedUserIdFromMe` (Option B: filter `GET
  /me?fields=business_users{id,business{id}}` by `business.id`) and
  `pickBusinessScopedUserIdByName` (Option A fallback: match `GET
  /{bizId}/business_users?fields=id,name` by display name against the token
  owner's own `/me` name). Split out from `business-manager.ts` (imports
  `client.ts`'s strip-mode-incompatible `MetaApiError` class) so the
  matching logic is unit-testable — same rationale as
  `business-manager-grant-request.ts`.
- `lib/meta/business-manager.ts` — new `resolveBusinessScopedUserId(bizId,
  token)`: tries Option B first (one call covers every BM the token belongs
  to), falls back to Option A per-BM if `business_users` isn't populated on
  `/me`, throws `MetaApiError` if neither resolves. In-memory
  `Map<bizId, string>` cache (safe keyed only by bizId — this app acts
  exclusively as Matas's personal token, so there's only one identity to
  resolve per BM). `getMetaUserId` kept as-is, docstring updated to flag
  it's audit/debug-only now, not usable for grants.
- `lib/bm/grant.ts` — `grantPagesForBusinessManager` now resolves BOTH ids
  once before the per-page loop (`fbUserId` via `getMetaUserId` for the
  audit trail, `targetUserId` via `resolveBusinessScopedUserId` for the
  actual grant) and passes `targetUserId` into `grantUserPagePermission`.
  `bm_page_access_events.detail` now logs both `target_user_id` and
  `fb_user_id` for cross-reference. Resolving once per BM (not per page)
  covers the "N pages, one BM, one resolve" caching requirement on its own;
  the in-memory cache in `business-manager.ts` additionally helps across
  separate warm-instance invocations (e.g. repeated single-page grant
  clicks).
- `lib/meta/__tests__/business-scoped-user-id.test.ts` (new) — unit tests
  for both pure matching helpers (match found / no match / missing id on
  match / missing/blank name / empty input).
- `lib/meta/__tests__/business-manager-grant-url.test.ts` — updated header
  comment + `TARGET_USER_ID` comment to clarify it now stands in for a
  resolved business-scoped id, not a Facebook-level id. No shape change —
  this builder is id-source-agnostic (`buildGrantUserPagePermissionRequest`
  just takes a `targetUserId` string; it doesn't care how it was resolved).

**Persistence:** skipped intentionally for v1, per the task's own
"optional... no migration needed if we skip persistence" — the in-memory
cache is sufficient for now. No `business_scoped_user_id` column added to
`client_business_managers`.

## Validation

- [x] `npm run build` — exit 0.
- [x] `npm test` — 3024 tests (+8 new), 3007 pass (+8), same 14 pre-existing
      unrelated failures as `main` — no new failures.
- [x] `npx eslint` on touched files — clean.
- [ ] Manual smoke test — Matas to re-run "Grant all missing" against LWE
      (5 pages) post-deploy; expect `granted: 5, failed: 0`.

## Notes

- If Option B's `business_users` field on `/me` turns out to be
  consistently populated in practice (per Meta's own docs it should be, for
  any BM the token holder is an admin/employee of), Option A's per-BM
  fallback call will rarely fire — kept as a safety net rather than the
  primary path since one `/me` call covering every BM is strictly cheaper.
