# HE1 · audience breakdowns (dashboard v2 phase 2)

Design record: `docs/design-record/2026-11-13-dashboard-v2-phase-2.html`, E1 "Who we reached", E8 HE1, frame EV1. Data layer only: ingest, storage, server read helpers. No UI.

## What's stored

Migration `245_audience_breakdowns.sql` (not applied; ops applies from main).

| Table | Grain | Figures |
|---|---|---|
| `meta_audience_breakdowns` | campaign × day × (age + gender \| region) | spend, impressions, clicks, link clicks, complete registrations, purchases, purchase value (revenue) |
| `tiktok_audience_breakdowns` | campaign × day × (age + gender \| UK nation) | spend, impressions, clicks |

- Meta: `GET /act_{id}/insights`, `level=campaign`, `time_increment=1`, spend > 0, attribution windows `7d_click,1d_view` (the same as `ad_daily_insights` and the rollup), once with `breakdowns=age,gender` and once with `breakdowns=region`. Registrations and purchases are the first action type present, never a sum (as `lib/ad-daily-insights/derive.ts`). Revenue is `action_values` for `offsite_conversion.fb_pixel_purchase`.
- **Meta returns no conversions under `breakdowns=region`.** Measured on NX26-LOCKLEAD, 1 Sep–14 Nov: £1,569.47 of spend and 500 signups by age, 0 signups and 0 purchases by region. Region rows are delivery only; the read helper's region figures have no signups, purchases or revenue, so a panel can't show false zeros.
- TikTok: `/report/integrated/get/`, `report_type=AUDIENCE`, `AUCTION_CAMPAIGN`, `stat_time_day`, once by `age`+`gender`, once by `province_id`. The province is a GeoNames id: 6269131 England, 2638360 Scotland, 2634895 Wales, 2641364 Northern Ireland; any other id is "Outside the UK" (summed into one row), -1 is "Unknown". Ages are written `18-24` … `55+`, genders `female` / `male` / `unknown`, as Meta writes them.

## Attribution

No second matcher.

- Meta: `metaCampaignOwners` in `lib/dashboard/sales-calc/figures.ts`, extracted unchanged from `mapCampaigns` (the calc now calls it): a `campaign_event_overrides` row (migration 240) first, then the id in `events.meta_campaign_id`, then the `[CODE]` exactly as written, first show in show order.
- TikTok: `campaignOwner` in `lib/attribution/campaign-owner.ts`: override, then `[CODE]`. A campaign with no name and no override is unattributed.
- `event_id` is written with each row. Readers check it again against today's overrides, so an override added later moves the rows without a rewrite.
- Shows of archived clients are left out, so their campaigns attribute to nothing and their accounts aren't read.

## Where it can't break

- `campaign_name` and `event_id` are never sent as NULL: a row that can't fill one leaves the key out, and rows are upserted in batches of identical key sets.
- If the shows or overrides can't be read, nothing is written.
- Every read pages in primary-key order through `lib/db/paged-read.ts`.
- One attempt per Meta call (`maxAttempts: 1`), every call counted. A rate-limited or auth-failed account stops and is reported. Any other failure costs that breakdown only. A code 1/2 span is split 7 → 3 → 1 days (the ad-daily-insights reader, now taking a params builder).
- TikTok: every request counted. 50001 or an auth code (40001, 40100, 40102, 40104, 40105, HTTP 401/403) stops the advertiser and writes nothing for it. `tiktokGet` itself waits and retries a 50001 once and retries a 5xx; those retries happen inside one counted call.
- The cron step starts no new account 600 s into the request; the rest are reported `deferred`.

## Switch

`ENABLE_AUDIENCE_BREAKDOWNS` must be exactly `"1"` (default off; not set by this PR). It gates both legs, inside `/api/cron/ad-daily-insights` (02:30 UTC). With it off the route does exactly what it did. With it on, the last three complete UTC days are restated after the ad insights, and the result is under `audienceBreakdowns`. The route's `maxDuration` is raised from 300 to 800 s (the same as `tiktok-breakdowns`) to leave room. TikTok tokens come from `get_tiktok_credentials` with `TIKTOK_TOKEN_KEY`, already set for the TikTok crons.

The env var belongs in CLAUDE.md's env list. CLAUDE.md is in open Cursor PR #986, so it isn't edited here (rule 3).

## Backfill

```
npx tsx --env-file=.env.local scripts/backfill-audience-breakdowns.mts --since 2026-08-01 --until 2026-11-14 --apply
```

Dry run by default: it reads Meta, TikTok and Supabase and writes nothing. `--event CODE` scopes it to one show's accounts and prints that show's rows and E1 tables; `--platform`, `--account`, `--tiktok-account`, `--json FILE`.

## Read helpers (`lib/audience-breakdowns/read.ts`)

`audienceBreakdownsForShow(db, eventId, period?)`, `audienceBreakdownsForVenue(db, clientId, venueKey, period?)` (venue_key exactly as stored; `null` is "Venue not set"), `audienceBreakdownsForClient(db, clientId, period?)`, `audienceBreakdownsForEvents(db, ids, period?)`. Each returns `{ meta: MetaAudience, tiktok: TikTokAudience }`:

- `MetaAudience`: `byAge`, `byGender`, `byAgeGender`, `byRegion` (delivery only), `total`, `firstDay`, `lastDay`, `campaigns`. A segment has spend, impressions, impression share, clicks, link clicks, CTR (link clicks ÷ impressions), signups, cost per signup, purchases, cost per purchase, revenue. A cost is null with no results.
- `TikTokAudience`: `byAge`, `byGender`, `byAgeGender`, `byNation` (fixed order), `total`, `firstDay`, `lastDay`, `campaigns`. Spend, impressions, share, clicks, CTR.

Before migration 245 is applied, every read is empty, not an error.
