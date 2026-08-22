# Session log

## PR

- **Number:** 829
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/829
- **Branch:** `cursor/ci-and-failing-tests`

## Summary

Add a GitHub Actions gate that runs `npm test` and `npm run build` on every PR, and make the existing 13 suite failures pass so that gate is meaningful.

## Scope / files

- `.github/workflows/ci.yml` — PR + main: Node 22, `npm ci`, then `npm test` and `npm run build` as parallel jobs
- `lib/dashboard/venue-trend-points.ts` — relative imports so the node test runner can load the module
- `lib/clients/asset-queue/__tests__/sheet-parse.test.ts` — convert leftover Jest syntax to node:test
- `lib/clients/asset-queue/__tests__/copy-generator.test.ts` — deleted (Jest + `jest.mock`; prompt coverage stays in `copy-ground-truth.test.ts`)
- `lib/meta/__tests__/creative-buy-tickets-cta.test.ts` — rotation path has no `asset_customization_rules`

## Validation

- [x] `npm test` — 4298 tests, 4295 pass, 0 fail, 3 skipped
- [ ] `npm run build` (CI job)

## Notes

- Follow-ups from #827 are tracked in https://github.com/matas-offpixel/meta-campaign-builder/issues/828
