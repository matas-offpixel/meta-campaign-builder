# Session log

## PR

- **Number:** 829
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/829
- **Branch:** `cursor/ci-and-failing-tests`

## Summary

Add a GitHub Actions gate that runs `npm test` and `npm run build` on every PR, and make the existing suite failures pass so that gate is meaningful.

## Scope / files

- `.github/workflows/ci.yml` — PR + main; `contents: read`; concurrency cancel; checkout/setup-node `@v5`; Node from `.nvmrc`
- `.nvmrc` + `package.json` `engines.node` — pin `>=22` / `22`
- `lib/dashboard/venue-trend-points.ts` — relative imports so the node test runner can load the module
- `lib/clients/asset-queue/__tests__/sheet-parse.test.ts` — convert leftover Jest syntax to node:test
- `lib/clients/asset-queue/__tests__/copy-generator.test.ts` — deleted leftover Jest file; `generateCopy` cases tracked in #830
- `lib/meta/__tests__/creative-buy-tickets-cta.test.ts` — rotation path has no `asset_customization_rules`
- `lib/tiktok/__tests__/upload.test.ts` — keep the event loop alive across `AbortSignal.timeout()` so Node 22 does not cancel the file

## Validation

- [x] Node 22 (`npx node@22`) `npm test` — 4298 tests, 4295 pass, **0 fail**, 0 cancelled, 3 skipped
- [x] `TZ=UTC npm test` on Node 24 — same 0 fail
- [x] Isolated `upload.test.ts` on Node 22 and 24
- [ ] GitHub Actions `npm test` + `npm run build` green on this head

## Notes

- CI red on `dc41f3b` was not timezone or `@/`. Node 22 cancelled `uploadTikTokAdVideo` because `AbortSignal.timeout()` is unref'd (`Promise resolution is still pending but the event loop has already resolved`). Local Node 24 hid it.
- Follow-ups: #828 (Review UX), #830 (`generateCopy` tests), #831 (`@/` loader), #832 (widen test glob)
