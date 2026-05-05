# Session log: discovery local event city render

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/discovery-local-event-city-render`

## Summary

Expose local event `venue_city` and `event_code` in the ticketing link discovery payload, then render each unlinked local event as a stacked cell so operators can distinguish same-name venues like O2 Academy Bournemouth, Leeds, Newcastle, and Glasgow.

## Scope / files

- `app/api/clients/[id]/ticketing-link-discovery/route.ts`
- `components/dashboard/clients/ticketing-link-discovery.tsx`
- `lib/ticketing/link-discovery.ts`

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [ ] `npm test` (when applicable)
- [x] `npm run lint -- "components/dashboard/clients/ticketing-link-discovery.tsx" "app/api/clients/[id]/ticketing-link-discovery/route.ts" "lib/ticketing/link-discovery.ts"`

## Notes

Right-side candidate rendering was left unchanged per the PR non-goals.
