# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/adset-push-one-click`

## Summary

The published-library audience push no longer previews before it writes. Apply posts once with `commit: true`. The learning-phase sentence stays under that button. The result list shows each ad set's outcome, reason, and diff, and a written add can be removed from that row.

## Scope / files

- `components/library/adset-audience-push.tsx` — one-click Apply, result list, row Remove
- `lib/meta/__tests__/adset-audience-push-ui.test.ts` — UI request shape
- `lib/meta/adset-targeting-write.ts` — unchanged
- `app/api/meta/adset-audience/route.ts` — unchanged; `commit: false` remains for other callers

## Validation

- [ ] `npm test`
- [ ] `npm run build`
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

The write module, the ledger, the gate, the 12-ad-set cap, and the read-merge-write contract are untouched. `planAdSetAudienceChanges` stays exported. Row Remove posts the same audience and include/exclude list, action `remove`, and that ad set id only. A second click while a request is in flight does not post again.
