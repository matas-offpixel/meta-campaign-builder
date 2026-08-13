# Session log

## PR

- **Number:** 769
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/769
- **Branch:** `cursor/blank-adset-sane-budget-floor`

## Summary

PR #756's `defaultBlankAdSetBudget` used `max(median, campaignDefault, 100)`,
so blank/Wide ad sets defaulted to £100/day even on small campaigns.
Reproducer: Puzzle Southampton 2026-08-13 — £25 daily campaign, 8 audience
sets at £3.13, Wide auto-defaulted to £100 and spent £29.72 before the
operator caught it. Replaced the £100 floor with a campaign-scale equal-
share formula (floor £1 for Meta's minimum) and added a Step 5 soft
warning when any enabled ad set's daily budget is >30% of the campaign total.

## Scope / files

- `lib/wizard/adset-suggestions.ts` — new formula + `findAdSetsExceedingBudgetShare`
- `lib/wizard/__tests__/adset-suggestions.test.ts` — Puzzle Southampton case + warning helper
- `components/steps/budget-schedule.tsx` — Step 5 >30% warning banner

## Validation

- [x] `node --test lib/wizard/__tests__/adset-suggestions.test.ts` — 40/40 pass
- [x] `npx eslint` on touched files — clean
- [ ] Manual: Step 5 on a £25 campaign with 8×£3.13 sets → "+ Blank ad set" ≈ £2.78; paste £100 on Wide → warning appears

## Notes

- When a campaign budget is set, equal-share always wins over median (cap).
  Median only matters when `budgetAmount` is unset/0.
- Warning is soft — does not block launch.
