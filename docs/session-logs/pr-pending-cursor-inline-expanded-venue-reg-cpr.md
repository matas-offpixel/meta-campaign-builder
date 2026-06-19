# Session log — inline expanded venue Reg/CPR

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/inline-expanded-venue-reg-cpr`

## Summary

Third and final surface: brings the inline expanded venue card on the client dashboard (`/clients/{id}/dashboard#expanded=IRW0004`) into parity with the standalone venue full report (PR #614) and per-event Reporting tab (PR #613). Replaces the "Ticket Revenue" 4th card with "Registrations + CPR", merges ticket revenue as a sub-line into the Tickets card, and wires Mailchimp snapshot fetching into the inline trend chart so Registrations + CPR pills appear.

## Scope / files

- `components/share/client-portal-venue-table.tsx`:
  - Added `MailchimpSnapshotRow` import
  - `VenueSection`: computed `mailchimpRegistrations` + `costPerRegistration` from `group.events`; added `useEffect` to fetch Mailchimp snapshots for the trend chart
  - `VenueCampaignPerformanceCards`: accepts two new props (`mailchimpRegistrations`, `costPerRegistration`); Tickets card gains "Revenue: —" sub-line; 4th card changed from "Ticket Revenue + ROAS" to "Registrations + CPR"
  - `EventTrendChart` call in inline expanded section: passes `mailchimpSnapshots`

## Validation

- [x] `npm run build` — passes
- [x] `npx eslint` — 0 new errors (4 pre-existing errors in `LazyVenueDailyBudget`, unrelated)

## Notes

- All three surfaces (per-event Reporting tab, standalone venue full report, inline dashboard card) now render identical Reg/CPR card + chart pills
- Candidate for a future architecture pass: extract a shared `VenueSummaryCards` component used by all three
