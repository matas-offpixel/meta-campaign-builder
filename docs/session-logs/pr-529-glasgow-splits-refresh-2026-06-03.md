# Session log

## PR

- **Number:** 529
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/529
- **Branch:** `cc/glasgow-splits-refresh-2026-06-03`

## Summary

Refreshed `CAMPAIGN_SPLITS` snapshot for Meta campaign `6925933901665` (`[WC26-GLASGOW-O2] TRAFFIC`) from 2026-05-29 to 2026-06-03 Meta MCP pull. O2 share moved 74.54% → 78.53% as O2 ad sets kept spending while SWG3 ad sets stayed paused, correcting ~£1,651 O2 over-attribution on the Glasgow Performance Summary.

## Scope / files

- `lib/dashboard/event-code-adset-splits.ts` — snapshot totals + share percents + SNAPSHOT DATE comment
- `lib/dashboard/__tests__/event-code-adset-splits.test.ts` — expectations for 21.47% split and June totals

## Validation

- [x] `node --test lib/dashboard/__tests__/event-code-adset-splits.test.ts` (16/16)
- [x] `npm run build`
- [x] eslint on changed dashboard files

## Notes

- Helpers unchanged; config consumed at read time (no SQL).
- Post-merge: verify Glasgow O2 spend ~£6,349 and SWG3 ~£2,819 on Performance Summary cards.
- Next refresh when any SWG3 ad set unpauses, O2 enters new flight, or quarterly.
