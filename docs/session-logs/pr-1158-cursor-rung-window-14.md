# 90% rung waits 14 days

## PR

- **Number:** 1158
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1158
- **Branch:** `cursor/rung-window-14`

## Summary

The 90% rung waits 14 days, because artwork refreshes every two weeks. The seed and Reset to default are the 15-rung ladder: rung 1 is "{release} live", rung 2 is "{release} selling fast", and the 90% rung is position 3 at 14 days. Migration 224 moves a client's 90% row from 7 to 14 only when it is still the 211 seed. Migration 225 splits rung 1 only when position 1 is still that seed, shifts the later rows down one without deleting them, and names a client whose rung 1 was edited. A ladder that is already split is left alone. The 90% row's main line is "Selling fast for {n}+ days, no count". The line under it is "the default" when the client's days are 14, and "{client}: {n} days (default 14)" when they are not. AB5 and AB2 are re-baselined once for the split. Design rules on those frames.

## Scope / files

- `lib/releases/ladder.ts` — fifteen rungs, days 14 at position 3
- `lib/releases/present.ts` — the two-line 90% wording, and the new rung's words
- `lib/releases/ladder-split.ts` — the split, checked without running SQL
- `lib/releases/held-split.ts` — the two held claims
- `lib/ticket-warnings/next-rung.ts` — rung 1 is the latest release that has gone live; line 2 never drops below selling fast
- `scripts/ladder-split-recompute.mts` — dry run by default
- `components/dashboard/asset-bank/surface.tsx` — AB2 cards and the static ladder
- `supabase/migrations/224_selling_fast_fourteen_days.sql` — written, not applied
- `supabase/migrations/225_rung_one_split.sql` — written, not applied
- `lib/releases/__tests__/bank.test.ts`
- `lib/releases/__tests__/ladder-split.test.ts`
- `lib/creative-lab/__tests__/caption-facts.test.ts`

## Validation

- [x] `node --conditions react-server --experimental-strip-types --test lib/releases/__tests__/bank.test.ts lib/releases/__tests__/ladder-split.test.ts` — passed
- [x] H20 dry run, claims and counts only: held "General sale live · selling fast" → "General sale live": 1. held "Presale live · selling fast" → locked: 1. Why: Ended — General sale went live Fri 30 Oct, so the presale is no longer the release to push. Approved, scheduled, live and done rows are not rewritten.
- [x] AB Ubuntu pair 42833865060 / 42833876436, both 0 against each other. AB2-1280 stays 1280×1248. AB2-393 stays 393×1301. AB5-1280 1280×1060 → 1280×1061. AB5-393 393×1611 → 393×1628. AB1, AB1b, AB3, AB4 and AB6 are 0 against main.
- [ ] CI green on the frame commit

## Notes

Until 225 is applied, a stored ladder still has the combined rung 1. The engine does not invent the new rung on top of that stored ladder, because position 2 would collide. Seed and Reset are the 15 rungs. 223 stays on `cursor/rail-3`. Neither migration is applied.
