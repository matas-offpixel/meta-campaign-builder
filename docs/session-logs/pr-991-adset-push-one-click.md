# Session log

## PR

- **Number:** 991
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/991
- **Branch:** `cursor/adset-push-one-click`

## Summary

The published-library audience push no longer previews before it writes. Apply posts once with `commit: true`. The learning-phase sentence stays under that button. The result list shows each ad set's outcome, reason, and diff, and a written add can be removed from that row.

## Scope / files

- `components/library/adset-audience-push.tsx` — one-click Apply, result list, row Remove
- `lib/meta/__tests__/adset-audience-push-ui.test.ts` — UI request shape
- `lib/meta/adset-targeting-write.ts` — unchanged
- `app/api/meta/adset-audience/route.ts` — unchanged; `commit: false` remains for other callers

## Validation

- [x] `npm test` — 6359 tests, 6355 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled in 20.1s, TypeScript finished in 35.4s
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

The write module, the ledger, the gate, the 12-ad-set cap, and the read-merge-write contract are untouched. `planAdSetAudienceChanges` stays exported. Row Remove posts the same audience and include/exclude list, action `remove`, and that ad set id only. A second click while a request is in flight does not post again.
