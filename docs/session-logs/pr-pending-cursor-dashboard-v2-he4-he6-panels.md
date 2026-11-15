# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/dashboard-v2-he4-he6-panels`

## Summary

HE4 and HE6 draw the presale log and the objective-and-budget table from the reads already on main. The figures are Electric Brixton's, D.O.D for the show. No active client has a presale log or a marketing budget entry, so the entered lines are empty and the client has no brand campaign.

## Scope / files

- `lib/dashboard/he-panels/**` — the words, the Electric fixture, and the two loaders
- `components/dashboard/presale-panel/**` and `components/dashboard/objective-budget-panel/**`
- Sales pages (internal and share) and the event overview
- Frames PS1, OB1 and OB2 at 1280 and 393, internal and share

## Validation

- [x] `node --test lib/dashboard/he-panels/__tests__/panels.test.ts`
- [x] `vitest run components/dashboard/sales/__tests__/he-panels.test.tsx`
- [x] `tsc --noEmit` reports no errors in the touched files
- [ ] `frames:check` — red until Ubuntu baselines exist. No local PNGs.

## Notes

The loaders call `loadPresaleLog` and `readObjectiveBudget` only. The total is paid + sub-budgets + D2C. Credits change the variance and nothing else. With no Bird rate the total says it excludes WhatsApp. The entry form is internal; the share link is read-only.
