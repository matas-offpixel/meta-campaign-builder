# Session log — proxy allowlist for event-rollup-backfill

## PR

- **Number:** 482
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/482
- **Branch:** `cursor/admin-event-rollup-backfill-public-prefix`

## Summary

Add `/api/admin/event-rollup-backfill` to `isPublicPath()` so Bearer `CRON_SECRET`
`?force=true` curls reach `fourthefansForceBackfill()` instead of 307 → `/login`.
Third recurrence of the PUBLIC_PREFIXES silent-fail pattern (after PR #468 et al.).

## Scope / files

- `lib/auth/public-routes.ts` — carve-out for event-rollup-backfill
- `lib/auth/__tests__/public-routes.test.ts` — admission test

## Validation

- [x] `node --test lib/auth/__tests__/public-routes.test.ts` (12/12 pass)
- [ ] `npx tsc --noEmit` (not run — two-line proxy change only)
- [ ] `npm run build` (not run)

## Notes

Post-merge: re-fire Option A force backfill and tail logs for Edinburgh allocator +
page-cap warn (Cowork verification).
