# Session log — cursor/unify-event-reporting-and-registrations

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/unify-event-reporting-and-registrations`

## Summary

Four fixes that make the internal dashboard production-grade for the single-event (Ironworks) flow:
1. **REGISTRATIONS column** — the client portal venue table "Pre-reg" column (which showed £0 for all single events) is replaced with a "Registrations" integer count sourced from `mailchimp_tag_snapshots` (tag-scoped, priority) or `mailchimp_audience_snapshots` (fallback). The prereg_spend value is preserved for Total Spend calculations.
2. **Meta campaign REGISTRATIONS: 0 fix** — `mapCampaignRow` and `mapCreativeRow` in `lib/insights/meta.ts` previously summed only `offsite_conversion.fb_pixel_lead`. They now use a priority-based picker matching the wider `REGISTRATION_ACTION_PRIORITY` list already used by the Active Creatives grouper, catching `complete_registration`, `lead`, and `onsite_conversion.lead_grouped`.
3. **Tab consolidation** — `LinkedCampaignsPerformance` (the legacy "CAMPAIGN PERFORMANCE" panel) is hidden from the Campaigns tab for single events. Brand_campaign events keep it; single events have `InternalEventReport` in the Reporting tab as the canonical performance view.
4. **Awaiting on-sale badge** — `CommsChip` ("Half sold" / "Selling fast") is suppressed when a venue or event has zero tickets sold, showing "Awaiting on-sale" instead. Fixes the confusing "Half sold" badge for unannounced events.

## Scope / files

- `lib/db/client-portal-server.ts` — add `mailchimp_tag` to events SELECT; load latest Mailchimp registrations per event (tag-scoped first, audience fallback); populate `PortalEvent.mailchimp_registrations`
- `components/share/client-portal-venue-table.tsx` — add `registrations` to `VenueTotals` + `OverallLondonTotals`; update headers + cells; fix CommsChip guard for zero tickets
- `components/share/venue-event-breakdown.tsx` — fix per-event and venue-level CommsChip guard for zero tickets
- `lib/insights/meta.ts` — add `REGISTRATION_ACTION_PRIORITY` const + `pickRegistrationValue`; use it in `mapCampaignRow` and `mapCreativeRow`
- `components/dashboard/events/event-detail.tsx` — hide `LinkedCampaignsPerformance` for non-brand events

## Validation

- [x] `npm run build` — passes cleanly, zero new errors
- [x] `npm run lint` — all errors pre-existing, none in changed files

## Notes

- The REGISTRATIONS column fetches Mailchimp counts sequentially after the main parallel fetches to avoid complicating the 12-way `Promise.all`. For clients with many events this adds ~1 Supabase round-trip; acceptable given the low query cost.
- For the Overall London aggregate table, the "Total" row in "Registrations" sums `mailchimp_registrations` across all events. For events that share a single Mailchimp audience (brand_campaign-style), this will over-count. The column is most meaningful for single events with per-event `mailchimp_tag`.
- `pickRegistrationValue` stops at the first matching action type, matching the `active-creatives-group.ts` behaviour. This prevents double-counting when Meta returns both `fb_pixel_lead` and `complete_registration` for the same campaign.
- Post-merge validation: Camelphat (IRW0004) should show REGISTRATIONS = ~{mailchimp_tag count} in the venue table after next cron run; Meta Campaign Stats REGISTRATIONS should show 21 (14+7) live.
