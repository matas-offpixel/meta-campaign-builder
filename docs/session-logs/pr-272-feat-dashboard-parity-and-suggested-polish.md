# Session Log

## PR

- **Number:** 272
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/272
- **Branch:** `feat/dashboard-parity-and-suggested-polish`

## Summary

Brings the client dashboard expanded venue rows onto the venue report event/tier breakdown path, adds SOLD OUT suggested-comms handling, and makes the venue daily tracker compact by default.

## Scope / files

- `components/share/venue-event-breakdown.tsx`
- `components/share/client-portal-venue-table.tsx`
- `components/dashboard/events/ticket-tiers-section.tsx`
- `components/share/venue-daily-report-block.tsx`
- `components/share/venue-full-report.tsx`
- `components/dashboard/events/daily-tracker.tsx`
- `lib/dashboard/suggested-pct.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `node --experimental-strip-types --test 'lib/dashboard/__tests__/suggested-pct.test.ts' 'lib/ticketing/__tests__/suggested-pct.test.ts'`
- [x] `npx eslint` on changed files
- [ ] `npm run lint` full repo: blocked by pre-existing unrelated lint errors.

## Notes

- Confirmed Brighton Croatia Earlybird tiers have `quantity_sold >= quantity_available`, so tier rows will display `SOLD OUT`.
- The main dashboard now renders `VenueEventBreakdown` inside expanded venue cards instead of the bespoke 13-column event table.
