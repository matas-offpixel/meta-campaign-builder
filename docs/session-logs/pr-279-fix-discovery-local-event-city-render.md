# Session log: discovery local event city render

## PR

- **Number:** 279
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/279
- **Branch:** `fix/discovery-local-event-city-render`

## Summary

Expose local event `venue_city` and `event_code` in the ticketing link discovery payload, then render each unlinked local event as a stacked cell so operators can distinguish same-name venues like O2 Academy Bournemouth, Leeds, Newcastle, and Glasgow. Candidate rows now use the same venue/city formatter when candidate city data is available.

## Scope / files

- `app/api/clients/[id]/ticketing-link-discovery/route.ts`
- `components/dashboard/clients/ticketing-link-discovery.tsx`
- `lib/ticketing/link-discovery.ts`

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [ ] `npm test` (when applicable)
- [x] `npm run lint -- "components/dashboard/clients/ticketing-link-discovery.tsx" "app/api/clients/[id]/ticketing-link-discovery/route.ts" "lib/ticketing/link-discovery.ts" "lib/ticketing/event-search.ts"`

## Notes

Right-side candidate rendering only changes when a candidate city field is available; current provider/cache data does not add new candidate DB columns.
