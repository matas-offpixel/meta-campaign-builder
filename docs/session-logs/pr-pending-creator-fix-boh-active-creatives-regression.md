## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/fix-boh-active-creatives-regression`

## Summary

PR #216 added build-version invalidation to active-creatives snapshots, but the production `active_creatives_snapshots` table did not yet have the `build_version` column. BOH therefore treated its existing `maximum` snapshot as unreadable, fell through to the cold live Meta fetch, and left the Suspense skeleton visible for a wide ticketed event. This fix makes active-creatives snapshot reads and writes backward-compatible with the legacy table shape so the existing snapshot renders while the background refresh remains decoupled from Google Ads.

## Scope / files

- `lib/db/active-creatives-snapshots.ts` adds a missing-`build_version` fallback for reads and writes.
- `lib/db/__tests__/active-creatives-snapshots.test.ts` covers legacy read/write fallback behavior.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint components/share/ lib/google-ads/ app/share/ components/report/google-ads-report-block.tsx lib/db/active-creatives-snapshots.ts lib/db/__tests__/active-creatives-snapshots.test.ts`
- [x] `node --experimental-strip-types --test 'lib/db/__tests__/active-creatives-snapshots.test.ts'`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- The requested broad `npx eslint components/report/ components/share/ lib/google-ads/ app/share/` still fails on pre-existing `react-hooks/set-state-in-effect` errors in `components/report/internal-event-report.tsx`.
- A local `next start` smoke test returned 500 for all share URLs because of the pre-existing route conflict `You cannot use different slug names for the same dynamic path ('eventId' !== 'id')`. The BOH snapshot helper was verified directly against Supabase and now returns the existing `maximum` snapshot (`kind: ok`, 30 groups).
