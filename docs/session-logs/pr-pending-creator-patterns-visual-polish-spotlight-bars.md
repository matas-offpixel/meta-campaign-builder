## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/patterns-visual-polish-spotlight-bars`

## Summary

Makes the internal creative patterns page easier to scan for non-marketers by adding per-dimension spotlights, performance badges, inline metric bars, and expanded six-metric tile layouts.

## Scope / files

- `app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx`
  - Adds top-3 spotlight strips above dimensions with more than three tagged values.
  - Reuses `PatternTile` with `size="lg"` for spotlight tiles.
  - Adds gold/silver/bronze spotlight borders and a `TOP PERFORMER` pill for rank 1.
  - Adds quartile badges, top/bottom left-edge tile stripes, MiniStat help buttons, and inline performance bars.
  - Expands each funnel lens to up to six visible MiniStats.
- `lib/reporting/patterns-quartile-rank.ts`
  - Adds a pure metric-quartile helper with nulls-last and spend-desc tie-breaking.
- `lib/reporting/__tests__/patterns-quartile-rank.test.ts`
  - Covers quartile assignment, null sorting, and tie-breaking.

## Validation

- [x] `node --experimental-strip-types --test lib/reporting/__tests__/patterns-quartile-rank.test.ts`
- [x] `npm run lint -- 'app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx' lib/reporting/patterns-quartile-rank.ts lib/reporting/__tests__/patterns-quartile-rank.test.ts`
- [x] `npx tsc --noEmit`

## Notes

No data-layer files, URL param logic, migrations, dependencies, chart libraries, or per-event share tag breakdown paths are touched.
