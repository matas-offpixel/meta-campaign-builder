# Session log — cursor/dashboard-rollup-cleanup

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/dashboard-rollup-cleanup`

## Summary

Five UX fixes to the Ironworks client portal dashboard: removed the redundant "Overall London" aggregate table that duplicated the top header; made marketing budget aggregate across ALL events (not just active-recency-filtered); added Total Registrations and Total CPR headline cards to the topline block (with updated subline); added per-venue inline Registrations + CPR chip to the collapsed venue header row; fixed the venue detail page header to include the artist name for single-event venues.

## Scope / files

- `lib/db/client-dashboard-aggregations.ts` — Added `mailchimp_registrations?: number | null` to `AggregatableEvent`; added `totalRegistrations: number` and `totalCpr: number | null` to `ClientWideTotals`; compute both fields in `aggregateClientWideTotals`.
- `components/share/client-portal.tsx` — Compute `allEventsBudget` from all events (bypasses active recency filter for budget); compute `allEventsRegistrations` sum; override `clientWideTotals.marketingBudget` and `totalRegistrations`/`totalCpr` so the topline always reflects the full portfolio.
- `components/share/client-wide-topline.tsx` — Expanded stat grid from 7 to 9 columns (added Total Registrations + Total CPR cards); replaced "Pre-reg / CPT" footer subline with "Total registrations · Total CPR · sell-through".
- `components/share/client-portal-venue-table.tsx` — Removed `OverallLondonSection` rendering inside the London region loop; added "Registrations: N · CPR: £X ·" chip to the collapsed venue header before the existing "Tickets:" metric.
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — For single-event venues, `venueTitle` now uses `event.name` (includes artist, e.g. "Ironworks — Camelphat") rather than falling straight to `venue_name`.

## Validation

- [x] `npm run build` — clean
- [x] `npm run lint` — no new errors in modified files

## Notes

- Budget override in `client-portal.tsx` uses `aggregateSharedVenueBudget(events)` (all events, no recency filter) so past/completed show budgets aren't silently dropped from the portfolio headline.
- CPR in the collapsed venue header uses `totals.total / totals.registrations` (total marketing spend ÷ tag-scoped registrations), matching the spec's £732 / 1,296 = £0.56 example.
- `OverallLondonSection` and its supporting `computeOverallLondon` / `OverallLondonTotals` code left in place (dead code but harmless) — removing them would widen scope unnecessarily.
