# Session Log - Snapshot Cache Deploy Invalidation

## PR

- **Number:** `pending`
- **URL:** pending
- **Branch:** `creator/snapshot-cache-deploy-invalidation`

## Summary

Adds deploy-scoped cache invalidation for `active_creatives_snapshots` and `share_insight_snapshots` by storing the current Vercel commit SHA on each snapshot row and treating rows from older builds, including existing `NULL` rows, as stale on read.

## Scope / files

- `supabase/migrations/064_snapshot_build_version.sql`
- `lib/build-version.ts`
- `lib/db/active-creatives-snapshots.ts`
- `lib/db/share-snapshots.ts`
- `lib/db/database.types.ts`
- `lib/db/__tests__/active-creatives-snapshots.test.ts`
- `lib/db/__tests__/share-snapshots.test.ts`

## Validation

- [x] `node --experimental-strip-types --test lib/db/__tests__/share-snapshots.test.ts lib/db/__tests__/active-creatives-snapshots.test.ts`
- [x] `npx eslint lib/build-version.ts lib/db/active-creatives-snapshots.ts lib/db/share-snapshots.ts lib/db/__tests__/active-creatives-snapshots.test.ts lib/db/__tests__/share-snapshots.test.ts`
- [x] `npm run build`
- [x] `npm test`
- [ ] `npm run lint` repo-wide

## Notes

- Repo-wide `npm run lint` is still blocked by unrelated existing lint debt, including `app/api/meta/interest-suggestions/route.ts`, `app/auth/facebook-error/page.tsx`, React hook `set-state-in-effect` errors in existing components/hooks, and unused-variable warnings. Touched-file lint passed.
- Migration `064_snapshot_build_version.sql` is committed only; it was not applied locally.
- Existing rows with `build_version = NULL` self-clean by missing the cache and being rewritten with the current build version on the next successful render/fetch path.
