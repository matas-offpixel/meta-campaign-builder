# Session log

## PR

- **Number:** 1227
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1227
- **Branch:** `cursor/dashboard-v2-model-parity-layout`

## Summary

Layout of dashboard v2 against the model (record #1226). Part 1 is the chart, Since launch, the bars, the tile names and the umbrella chip. Part 2, after #1228, reads the new fields: the venue row, the totals and their hover, the header sentence, and the all-shows pace.

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

The layout reads the model fields and does not edit `lib/dashboard/sales-vs-spend.ts` or `lib/dashboard/sales-calc/**`.

Cost per ticket at 1280 keeps "complete windows" on every period except Since launch. At 393 that phrase stays off.

The venue row, the header sentence, the spend scope line and the spend hover render `venues`, `header`, `spendTotal` and `summary` when the model sends them. `summary.pace.value` is shown as "{n} a day". `sellsOut` on a bar wins over the inferred range. The fixture is still the 12 Nov NX series, so its pace tile is "— a day"; 113.3 / 155.3 is the live calc's pace, not a number this layout writes. The fixture's channel split is the 14-day one (£4,210 + £520) and does not sum to the £9,840 since-launch total.

The umbrella view shows its subtitle (the event name, then "not a show: no tickets and no trajectory") under the title and above the header sentence. A channel line with no money figure is left out. The spend hover headline is mono caps.

Baselines for DV1–DV3, NV1, NV2, NV5 and NV6 at 1280 and 393 are the PNGs from CI run 43582504808 (head `5319b8b`), copied byte for byte.
