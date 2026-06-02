# Session log — Registrations card on brand_campaign performance summary

## PR

- **Number:** 498
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/498
- **Branch:** `cursor/registrations-card`

## Summary

Adds a REGISTRATIONS summary card to the Campaign Performance header strip on the event detail page (`/events/[id]`) and the public share report. For `brand_campaign` events the strip now reads `[TOTAL MARKETING] [PAID MEDIA] [REGISTRATIONS]`. Ticket-sale events (`kind = 'event'`) are unchanged. The card derives new-since-baseline registrations from `mailchimp_audience_snapshots`, shows cost-per-registration against the window's paid media spend, and surfaces a stale-data warning when the latest snapshot is older than 48 hours.

## Scope / files

- `lib/mailchimp/compute-registrations.ts` — NEW. Pure `computeRegistrationsData` function (no server-only, importable by tests).
- `lib/mailchimp/registrations-loader.ts` — NEW. Server-side `loadEventRegistrations(supabase, eventId)` that resolves the audience id (event override → client default) and fetches snapshots.
- `app/api/events/[id]/mailchimp/snapshots/route.ts` — NEW. Authenticated GET endpoint so `InternalEventReport` can fetch registrations data client-side.
- `components/report/RegistrationsCard.tsx` — NEW. Pure presentational card matching the TICKETS card layout.
- `components/report/event-report-view.tsx` — Added `registrationsData` prop to both `Props` (EventReportView) and `MetaReportBlockProps`; renders `RegistrationsCard` for brand campaigns in place of the suppressed Tickets card.
- `components/report/internal-event-report.tsx` — Fetches `/api/events/[id]/mailchimp/snapshots` client-side and passes `registrationsData` to `EventReportView`.
- `components/report/public-report.tsx` — Added `registrationsData` prop; threads through to `EventReportView`.
- `app/share/report/[token]/page.tsx` — Imports `computeRegistrationsData`, computes `registrationsData` from already-fetched snapshots, passes to `PublicReport`.
- `lib/mailchimp/__tests__/registrations.test.ts` — NEW. 6 unit tests covering growth, zero-growth, no audience, null subscribers, single snapshot.

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing errors in `lib/audiences/__tests__/` and one test file unchanged)
- [x] `npm run lint` — 0 errors in new/modified files
- [x] `node --experimental-strip-types --test lib/mailchimp/__tests__/registrations.test.ts` — 6/6 pass

## Notes

- CPR uses `paidMediaSpent` (window-scoped, same as PAID MEDIA card). Lifetime by default since the default timeframe is "maximum".
- The `registrationsData` prop is `null` for non-brand-campaign events, and `MetaReportBlock` gates the card on `isBrandCampaign`.
- Stale-data warning fires when `lastSyncedAt` is >48h old, using a `useState` clock initialised at mount to avoid the `react-hooks/purity` ESLint rule on `Date.now()`.
- The existing `MailchimpRegistrationsCard` (lower Event Reporting section) is untouched; this PR adds a *new* card one section higher in the Campaign Performance strip.
