# Session log — pr-pending-cursor-mailchimp-audience-sync

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/mailchimp-audience-sync`

## Summary

Adds live Mailchimp Marketing API integration to the Off/Pixel dashboard. The feature includes a complete encrypted-credential connect flow (API-key-based, mirroring TikTok), a daily cron that upserts audience snapshots for brand-campaign events, a `MailchimpRegistrationsCard` widget on the share report, and a Mailchimp audience picker on the client overview page. Includes the Ironworks [IRWOHD] baseline backfill (3,000 total / 2,996 subscribers as of 2026-06-02).

## Scope / files

- `supabase/migrations/100_mailchimp_integration.sql` — `mailchimp_accounts`, FK columns on `clients`/`events`, `mailchimp_audience_snapshots`, RPCs, Ironworks backfill
- `lib/mailchimp/client.ts` — thin Mailchimp Marketing API v3 wrapper (fetch, retry, `getAudience`, `listAudiences`, `pingMailchimp`, `getAccountInfo`)
- `lib/mailchimp/credentials.ts` — encrypted credential helpers (mirrors `lib/tiktok/credentials.ts`)
- `lib/mailchimp/sync.ts` — shared `syncMailchimpAudienceForEvent` used by cron + manual refresh
- `app/api/integrations/mailchimp/connect/route.ts` — POST (connect) / DELETE (disconnect)
- `app/api/integrations/mailchimp/audiences/route.ts` — GET audiences for picker
- `app/(dashboard)/settings/mailchimp/page.tsx` — API-key paste form
- `app/api/cron/sync-mailchimp-audiences/route.ts` — daily 06:00 UTC cron
- `app/api/events/[id]/mailchimp/refresh/route.ts` — manual per-event refresh
- `components/report/mailchimp-registrations-card.tsx` — share report widget
- `components/report/event-report-view.tsx` — `mailchimpSlot` prop added
- `components/report/public-report.tsx` — `mailchimpSlot` prop added
- `app/share/report/[token]/page.tsx` — loads snapshots, computes CPR, passes slot
- `components/dashboard/clients/platform-accounts-card.tsx` — Mailchimp audience picker row added (4-column grid)
- `app/api/clients/[id]/route.ts` — `mailchimp_account_id` + `mailchimp_audience_id` added to ALLOWED_FIELDS
- `lib/settings/connection-status.ts` — Mailchimp added to connection statuses + PlatformConnectionStatus union
- `vercel.json` — `0 6 * * *` cron schedule for sync-mailchimp-audiences
- `__tests__/share-report/mailchimp-registrations.test.ts` — 6 unit tests for the registrations computation logic

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `node --test __tests__/share-report/mailchimp-registrations.test.ts`

## Notes

- `MAILCHIMP_TOKEN_KEY` env var needed in Vercel (used as the pgcrypto encryption key, not the Mailchimp API key itself — the API key lives encrypted in `mailchimp_accounts.credentials_encrypted`).
- CPR is computed from Meta + TikTok + Google spend summed from `event_daily_rollups`. As Google Ads spend wires up this will flow automatically.
- The Ironworks audience picker will show "Not linked" until a Mailchimp account is connected and `clients.mailchimp_account_id` is set. The audience id backfill already wrote `clients.mailchimp_audience_id = '6b62bb8448'`.
