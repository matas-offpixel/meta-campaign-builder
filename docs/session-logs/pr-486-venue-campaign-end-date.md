# Session log — venue campaign end date fix

## PR

- **Number:** 486
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/486
- **Branch:** `cc/venue-campaign-end-date`

## Summary

Fixed Funnel Pacing "days until event" using MIN upcoming fixture instead of MAX
campaign end date. Extracted `venueCampaignEndDate()` helper; both internal and
share venue pages now pass MAX(event_date) into `buildVenueCanonicalFunnel`.

## Scope / files

- `lib/dashboard/venue-campaign-end-date.ts` (new)
- `lib/dashboard/__tests__/venue-campaign-end-date.test.ts` (new, 10 tests)
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`
- `app/share/venue/[token]/page.tsx`
- `lib/dashboard/venue-canonical-funnel.ts` (JSDoc only)
- `docs/DIAGNOSIS-venue-campaign-end-date.md` (Phase 1)

## Validation

- [x] `npm run build` — exit 0
- [x] `node --test` venue-campaign-end-date — 10/10 pass
