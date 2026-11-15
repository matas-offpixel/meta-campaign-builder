# HE2 · CIRQLIN page audience ingest (dashboard v2 phase 2)

Data layer only: client, storage, a cron step, a read helper. No UI.

## Source

`GET {CIRQLIN_API_BASE}/api/partner/page-audience?page_id={uuid}[&from&to]` (cirqlin #631, live). Bearer `CIRQLIN_PARTNER_READ_SECRET`, base `CIRQLIN_API_BASE`, the same as `/api/partner/signups`. The two endpoints share one rate-limit bucket: 60 calls per 10 minutes per IP. The cron asks all time (no `from` / `to`).

`lib/cirqlin/page-audience/client.ts` keeps only `page_id`, `signups`, `geography { cities [{ name, region, country, signups }], everywhere_else, couldnt_tell }`, `consent { marketing, channels_offered }`, `community_joined`, `community_link_clicks`, `community_code_shared`, `whatsapp_with_phone`, `partner_opt_in` and `daily_timezone`. Any other key is dropped. A body whose cities + everywhere_else + couldnt_tell isn't signups is rejected (`geography_mismatch`), and so is a body for another page id. 401 → `unauthorized`, 404 → `no_page`, 400 → `bad_request`, 429 → `rate_limited`, anything else → `read_failed`. It never throws and never logs.

## Storage

Migration `247_cirqlin_page_audience.sql` (not applied; ops applies from main). One row per `(page_id, fetch_day)`, where fetch_day is the UTC day of the fetch, holding the page's all-time figures plus `fetched_at`. `event_id` is the event whose `events.cirqlin_page_id` is the page; `is_umbrella` is copied from `events.is_umbrella`, so the umbrella page (nx-loves-aw26 on NX26-GLOBAL) is its own row. Counts only, no person-level data. RLS: owner select through `event_id`, service-role writes (the 245 pattern).

## The step

`lib/cirqlin/page-audience/step.ts`, run in `/api/cron/mailchimp-eod-snapshot` (23:55 UTC) after the CIRQLIN signups pass.

- **`ENABLE_CIRQLIN_AUDIENCE_INGEST`** must be exactly `"1"`. It is off by default and this PR doesn't set it. Off, the step makes no call and no read, and the cron's response and run-log detail are as before, apart from `partnerCalls`.
- Every linked page of a show whose client isn't archived gets one call, in sequence. Pages fetched longest ago go first.
- **The bucket:** the route counts the signups pass's partner calls (page id and tag fallback alike) through a counting `fetchImpl`. The step makes at most `60 − that` calls and reports the pages it couldn't reach as `skippedOnBucket`.
- A 429 stops the step and is reported. A 401 or 404 skips that page and is reported, and so are a 400, a failed shape or geography check, a failed read and an upsert error. The cron's existing time budget (270 s) stops it too (`skippedOnTime`).
- **The self-check (the smoke test):** each page's `signups` is compared with the stored `/signups` total, which is the event's newest `signup_source_snapshots` row for source `cirqlin`, when that row came from the page-id read for this page. The result is stored on the row as `signups_check`: `ok`, `mismatch` (with `signups_stored`), or `unchecked` when there's no stored page-id total, for example a tag-only sync or a failed signups read. A mismatch is logged with both numbers and never corrected.
- The result is in the cron response under `pageAudience` and in the `mailchimp-eod-snapshot:cirqlin` run log's detail. It doesn't change that leg's `ok`, and no new cron name is registered, so an off switch can't trip the cron alarms.

Prod today (read-only count, 15 Nov): 15 events have a page, and 28 events have a page or a tag. The signups pass makes between 28 and 38 calls a night, which leaves at least 22 for 15 pages.

The env var belongs in CLAUDE.md's env list. CLAUDE.md is in open Cursor PR #986, so it isn't edited here (rule 3).

## Read helper

`lib/cirqlin/page-audience/read.ts`:

- `pageAudienceForShow(db, eventId)` returns that event's figures or null.
- `pageAudienceForEvents(db, eventIds)` returns `{ shows, umbrellas }`.
- `pageAudienceForClient(db, clientId)` returns `{ shows, umbrellas, umbrella }`.

The latest row is read per page through today's `events.cirqlin_page_id` link. The umbrella is never in `shows`, and nothing sums rows. Before 247 is applied, every read is empty.

`PageAudienceFigures` has these fields:

| Field | What it holds |
|---|---|
| `eventId`, `pageId`, `isUmbrella` | Which show and page the row is for |
| `fetchDay`, `fetchedAt` | When it was fetched |
| `signups` | All-time signups |
| `geography` | `{ cities [{ name, region, country, signups }], everywhereElse, couldntTell }`, cities most first |
| `consentMarketing`, `channelsOffered` | Marketing consent count and the channels offered |
| `communityJoined`, `communityLinkClicks`, `communityCodeShared` | Community figures |
| `whatsappWithPhone`, `partnerOptIn` | WhatsApp and partner opt-in counts |
| `dailyTimezone` | The page's timezone |
| `signupsCheck` | `{ status, stored, storedAt }` |

## No live run

The secret is a Sensitive Vercel var and isn't in `.env.local`. No live call was made, and all tests use fixtures shaped like the #631 body.
