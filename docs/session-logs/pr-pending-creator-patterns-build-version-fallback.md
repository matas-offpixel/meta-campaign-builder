## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/patterns-build-version-fallback`

## Summary

Fixes the internal creative patterns page returning empty tile sets after each deploy by allowing cross-event snapshot reads to use the newest warmed snapshot per event regardless of `build_version`.

## Scope / files

- `lib/reporting/creative-patterns-cross-event.ts` drops the `build_version` equality filter from the internal patterns snapshot query and documents why stale-build snapshots are acceptable there.
- `lib/reporting/creative-patterns-snapshots.ts` adds a pure latest-per-event selector.
- `lib/reporting/__tests__/creative-patterns-snapshots.test.ts` covers mixed current, old, and null `build_version` snapshots.

## Validation

- [x] `node --experimental-strip-types --test lib/reporting/__tests__/creative-patterns-snapshots.test.ts`
- [x] `npm run lint -- lib/reporting/creative-patterns-cross-event.ts lib/reporting/creative-patterns-snapshots.ts lib/reporting/__tests__/creative-patterns-snapshots.test.ts`
- [x] `npx tsc --noEmit`

## Notes

The share route build-version gate remains unchanged in the active-creatives snapshot read path.
