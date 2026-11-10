# 90% rung waits 14 days

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/rung-window-14`

## Summary

The 90% rung waits 14 days, because artwork refreshes every two weeks. The seed and Reset to default use 14. Migration 224 moves a client's row from 7 to 14 only when it is still the 211 seed, and names anyone who edited it. The rung-1 split is a design record on main and is not in this branch; the update finds the rung by kind, value, template and options, so it is the same row at position 2 today and at position 3 after that split. H19: selling fast for 15 days proposes "90% sold out"; 13 days does not. AB5 is re-baselined because the row now reads "Selling fast for 14+ days · default 14", including at 393, where that row was previously hidden. Design rules on that text in the verdict.

## Scope / files

- `lib/releases/ladder.ts` — seed and reset, days 14
- `lib/releases/present.ts` — the default row's words
- `lib/ticket-warnings/next-rung.ts` — the wait, when a row has no days of its own
- `components/dashboard/asset-bank/surface.tsx` — the AB5 line
- `supabase/migrations/224_selling_fast_fourteen_days.sql` — written, not applied
- `lib/releases/__tests__/bank.test.ts`

## Validation

- [ ] `node --conditions react-server --experimental-strip-types --test lib/releases/__tests__/bank.test.ts`
- [ ] AB5 Ubuntu pair, both 0, then the frames that moved
- [ ] CI green on the frame commit

## Notes

On 10 Nov every client still read days 7, so the notice list should be empty and all 17 become 14. A second run changes nothing. 223 is left for the unmerged copy-features migration on `cursor/rail-3`.
