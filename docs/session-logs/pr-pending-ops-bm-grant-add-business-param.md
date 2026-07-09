# Session log — BM Asset Sync: add required `business` param to grant body

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cc/ops/bm-grant-add-business-param`

## Summary

Follow-up to PR #708. That PR fixed the grant endpoint's *path*
(`/{pageId}/assigned_users`), but live grants against LWE's Business Manager
(741799859254067) still failed — Meta code 100 "Invalid parameter" instead
of the earlier "Unknown path components". Root cause: the `assigned_users`
edge requires **three** body params (`business`, `user`, `tasks`), and
`buildGrantUserPagePermissionRequest` only sent `user` + `tasks`.

## Scope / files

- `lib/meta/business-manager-grant-request.ts` — `GrantUserPagePermissionRequest.body`
  now includes `business: string`; `buildGrantUserPagePermissionRequest` takes
  a new `businessId` param (signature:
  `(pageId, businessId, targetUserId, role)`) and includes it in the body.
- `lib/meta/business-manager.ts` — `grantUserPagePermission`'s own signature
  is unchanged (already took `bizId` as its first param, added in #708's
  precursor); it now threads that value into the builder call instead of
  only using it for the log line.
- `lib/meta/__tests__/business-manager-grant-url.test.ts` — updated the
  existing byte-diff assertions to the new 3-field body shape and added a
  same-test regression check that `business` is present/non-blank for every
  `BMPageRole`. Test count intentionally unchanged (2 `it()`s) — the new
  assertions were folded into the existing cases rather than adding new
  tests, per the fix's own "test count unchanged" requirement.
- No other callers needed changes: `lib/bm/grant.ts` already passes `bizId`
  into `grantUserPagePermission` (its signature didn't change), and both
  grant route handlers only go through `grantPagesForBusinessManager` /
  `grant.ts` — neither calls the builder or `grantUserPagePermission`
  directly. Verified via `grep -rn "buildGrantUserPagePermissionRequest\|grantUserPagePermission"`.

## Validation

- [x] `npm run build` — exit 0.
- [x] `npm test` — 3016 tests, 2999 pass, same 14 pre-existing unrelated
      failures as on `main` (module-not-found / creative-buy-tickets-cta —
      untouched by this change).
- [x] `npx eslint` on touched files — clean.
- [ ] Manual smoke test — Matas to re-run "Grant all missing" against LWE
      (5 pages) post-deploy.

## Notes

- Confirmed against Meta's current Graph API reference
  (`developers.facebook.com/docs/graph-api/reference/page/assigned_users/`):
  `business`, `user`, and `tasks` are all required body params for
  `POST /{page-id}/assigned_users`.
