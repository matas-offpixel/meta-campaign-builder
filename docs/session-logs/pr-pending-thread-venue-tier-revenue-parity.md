# Session log (pending PR)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `thread/venue-tier-revenue-parity`

## Summary

Adds a defensive normalisation step before every additional-spend and
additional-ticket-entries client fetch so duplicated path segments such as
`/additional-spend/additional-spend` (same class of bug as tier-channel
`apiBase` double suffix, PR #283) collapse to a single collection segment.
This prevents the browser from following a misrouted URL that returns an
HTML document (often after middleware redirect) and surfacing
`non-JSON response - <!DOCTYPE html>…` in the venue report cards.

## Scope / files

- `lib/dedupe-adjacent-api-path-segment.ts` — shared `dedupeAdjacentApiPathSegment`
- `lib/__tests__/dedupe-adjacent-api-path-segment.test.ts`
- `components/dashboard/events/venue-additional-spend-card.tsx` — wrap all
  spend URLs; document `venueScope.eventCode` contract
- `components/dashboard/events/additional-spend-card.tsx` — dedupe list + row URLs
- `components/dashboard/events/additional-ticket-entries-card.tsx` — dedupe
  ticket-entry URLs (including `?event_id=` share reads)

## Validation

- [x] `npx eslint` on modified files
- [x] `npm run test` (includes new dedupe tests)
- [ ] Manual: refresh internal venue report
  `/clients/…/venues/WC26-MANCHESTER` — Additional spend shows empty state
  without HTML parse errors; POST returns JSON

## Notes

Regex allows a duplicated segment to be followed by `?query` so share-token
list URLs stay corrected.
