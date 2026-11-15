# Session log

## PR

- **Number:** 1261
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1261
- **Branch:** `cursor/dashboard-v2-he4-he6-panels`

## Summary

HE4 and HE6 draw the presale log and the objective-and-budget table from the reads already on main. The figures are Electric Brixton's, D.O.D for the show. No active client has a presale log or a marketing budget entry, so the entered lines are empty and the client has no brand campaign.

## Scope / files

- `lib/dashboard/he-panels/**` — the words, the Electric fixture, and the two loaders
- `components/dashboard/presale-panel/**` and `components/dashboard/objective-budget-panel/**`
- Sales pages (internal and share) and the event overview
- Frames PS1, PS2, OB1, OB2 and OB3 at 1280 and 393, internal and share. PS2 uses Charlotte de Witte's presale time on prod (5 Aug 2026, 12:00 London).

## Validation

- [x] `node --test lib/dashboard/he-panels/__tests__/panels.test.ts`
- [x] `vitest run components/dashboard/sales/__tests__/he-panels.test.tsx`
- [x] `tsc --noEmit` reports no errors in the touched files
- [ ] `frames:check` — red until Ubuntu baselines exist. No local PNGs.

## Notes

The loaders call `loadPresaleLog` and `readObjectiveBudget` only. The total is paid + sub-budgets + D2C. Credits change the variance and nothing else. With no Bird rate the total says it excludes WhatsApp. The entry form is internal; the share link is read-only.

Design fail at e1ccaa5. An empty presale shows only the rows that have a figure, and the share link drops "Add the window figures". The spend row is titled "Signup spend"; its source stays "Meta signup spend". An empty credit or sub-budget reads "—" and "None entered.", and the credit's note says it changes the variance, not the total. A plan summed from shows says "Show budgets". The total line says "Paid + sub-budgets + D2C."

OB3 holds Ironworks Season 1 from the submitted report (to 4 Nov, read 13 Nov). It is not written to prod. The two afterparties are one line of £1,297.27 because the report doesn't split them. The season-budget source on that frame says "entered by Matas, 13 Nov". A live season budget cannot say who entered it: `BudgetEntry` has a label and an entry date, and no entered-by name.

PS2 is Charlotte de Witte. The window start is derived from the prod presale time: 5 Aug, 11:30. Signups are the Mailchimp end-of-day count, so the source names the tag. The entered figures say "entered by Matas, 13 Nov". Signup spend is £5,771.82, and £0.87 a ticket is derived from that and the 6,600 presale-day tickets.
