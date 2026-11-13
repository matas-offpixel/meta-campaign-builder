# Session log

## PR

- **Number:** 1219
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1219
- **Branch:** `cursor/dashboard-v2-layout`

## Summary

The sales-vs-spend layout (DV1–DV3) is one component tree for the internal page and the share route. Both read `SalesDashboardModel`. The share variant drops cross-client learnings and the "Not linked to event" pill. Figures are the 12 Nov NX fixture until the server calc fills that type.

## Scope / files

- `lib/dashboard/sales-vs-spend.ts` — `SalesDashboardModel` and the share/axis/period helpers
- `lib/dashboard/sales-vs-spend-fixture.ts` — 12 Nov NX fixture. Locklead has no capacity
- `components/dashboard/sales/` — chips, presets, 12 tiles, chart, trajectory, campaigns
- `app/(dashboard)/clients/[id]/sales/page.tsx` — internal
- `app/share/client/[token]/sales/page.tsx` — share, fixture token `nx-12-nov` only
- `app/(dev)/frames/sales/[id]/page.tsx` — DV1–DV3, off the shared frames page
- `scripts/plan-frames/dashboard-v2-shots.mjs` — appended last in `run.mjs`

## Validation

- [x] `node --conditions react-server --experimental-strip-types --test lib/dashboard/__tests__/sales-vs-spend.test.ts`
- [x] eslint on the new files
- [x] Share page rendered at 1280 and 393, plus all-shows and Locklead. Internal route redirects to login without a session
- [ ] `npm run build` and `frames:check` — CI. New shots have no baseline yet; the plan-frames artifact holds the Ubuntu rasters

## Notes

No Meta or Google writes. Capacity is never defaulted. `SalesDashboardModel` stays the seam for the server calc. Added on a single show's trajectory: `showDayIso`, `counts`, `pace` (to D−7), and `needed`. A campaign row now has `delivery`, `unlinked`, and a since-launch figure. The DV entry is appended at the end of `FRAME_SHOTS`.
