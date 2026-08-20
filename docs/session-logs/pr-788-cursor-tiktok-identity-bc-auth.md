# Session log — TikTok identity unfiltered fetch

## PR

- **Number:** 788
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/788
- **Branch:** `cursor/tiktok-identity-bc-auth`

## Summary

`/identity/get/` was called once per identity_type without
`identity_authorized_bc_id`, which TikTok requires for BC_AUTH_TT. TikTok
returns code:0 with an empty list, so Business-Center-shared identities
were invisible. Switch to a single unfiltered call, parse the array
tolerantly, isolate per-type fallback failures, and stop writing `MANUAL`
as an identity_type.

## Scope / files

- `lib/tiktok/identity.ts`
- `app/api/tiktok/identities/route.ts`
- `components/tiktok-wizard/steps/account-setup.tsx`
- `lib/tiktok/write/mapping.ts` (enum membership only)
- `lib/tiktok-wizard/validation.ts` (block leftover MANUAL)
- Tests under `lib/tiktok/__tests__/identity.test.ts`

## Validation

- [x] TikTok identity + mapping + wizard validation tests
- [x] ESLint on changed files (0 errors; repo-wide lint still fails on pre-existing worktree/main issues)
- [x] `npm run build`

## Notes

- Do not enumerate Business Centers or send `identity_authorized_bc_id`
  in this PR. Grep Vercel for the unfiltered envelope log first.
- `OFFPIXEL_TIKTOK_WRITES_ENABLED` stays unset.
- Review follow-up: wrap the unfiltered `/identity/get/` call so a throw
  still runs the per-type ladder; never guess `TT_USER` for a missing
  `identity_type` (return `null` and let the operator pick).
  `mapTikTokIdentityType` already rejects null via `if (!identityType)`.
