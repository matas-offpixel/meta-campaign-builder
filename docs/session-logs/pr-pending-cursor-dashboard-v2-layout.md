# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/dashboard-v2-layout`

## Summary

The sales-vs-spend layout (DV1–DV3) is one component tree for the internal page and the share route. Both read `SalesDashboardModel`. The share variant drops cross-client learnings and the "Not linked to event" pill. Figures are the 12 Nov NX fixture until the server calc fills that type.

## Scope / files

- `lib/dashboard/sales-vs-spend.ts` — `SalesDashboardModel` and the share/axis/period helpers
- `lib/dashboard/sales-vs-spend-fixture.ts` — 12 Nov NX fixture. Locklead has no capacity
- `components/dashboard/sales/` — chips, presets, 12 tiles, chart, trajectory, campaigns
- `app/(dashboard)/clients/[id]/sales/page.tsx` — internal
- `app/share/client/[token]/sales/page.tsx` — share, fixture token `nx-12-nov` only
- `scripts/plan-frames/dashboard-v2-shots.mjs` — DV1–DV3 at 1280 and 393, not registered in `run.mjs`

## Validation

- [x] `node --conditions react-server --experimental-strip-types --test lib/dashboard/__tests__/sales-vs-spend.test.ts`
- [x] eslint on the new files
- [x] Share page rendered at 1280 and 393, plus all-shows and Locklead. Internal route redirects to login without a session
- [ ] `npm run build` — CI. Frame registration waits until `run.mjs` is free

## Notes

No Meta or Google writes. Capacity is never defaulted. `scripts/plan-frames/run.mjs` was not edited.
