# Session log

## PR

- **Number:** 1227
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1227
- **Branch:** `cursor/dashboard-v2-model-parity-layout`

## Summary

Layout part 1 of dashboard v2 against the model (record #1226): chart axes, Since launch as the default period, all-shows trajectory bars, the model's tile names, and the umbrella chip. Venue row, totals hover, and the header sentence wait on the new model fields.

## Scope / files

- `components/dashboard/sales/sales-chart.tsx`, `chart-axes.ts`, `tile-copy.ts`
- `components/dashboard/sales/sales-dashboard.tsx`, `trajectory-bars.ts`
- `components/dashboard/sales/frame-mount.tsx`
- `scripts/plan-frames/dashboard-v2-ids.ts`, `dashboard-v2-shots.mjs`
- `components/dashboard/sales/__tests__/layout-parity.test.tsx`

## Validation

- [x] `./node_modules/.bin/vitest run` on the sales chart and layout tests
- [x] `eslint` on the touched files
- [x] `node --test lib/dashboard/__tests__/sales-vs-spend.test.ts`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`

## Notes

The layout reads `SalesDashboardModel` as it is. Pace, the registrations "plus n" line, the umbrella page, and a 2,000 capacity are not in the fixture, so the frames keep the 12 Nov NX fixture figures. `lib/dashboard/sales-vs-spend.ts` and `lib/dashboard/sales-calc/**` were not edited.

Design fail at 6441e59: the index control matches the caption size, tile values do not inherit the heading uppercase, SELLS OUT is mono caps in the destructive colour, Total sold stays "to date · Internal Counts, {date}" (plus comps when the authored detail has them), and Cost per ticket says "the {n} shows with counts" when a show in the all-shows bars has no count. The all-shows pace is still "— a day"; the model has no 7-day or 14-day pace on that view.
