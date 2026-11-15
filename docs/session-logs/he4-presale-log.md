# HE4 presale log: data layer, 15 Nov 2026

HE4's presale log data layer: entered figures, the read helper, and the HE2 adapter. There is no UI yet.

| PR | What | Merged |
|---|---|---|
| #1255 | Migration 249 (`presale_logs`, `presale_relaunches`, `community_member_counts`; owner-only read, session-checked server actions), `lib/dashboard/presale/` read helper, HE2 adapter | `6af4e52` |
| #1257 | Design's rulings on #1255: signups label, Mailchimp fallback, entered-by names, "Meta signup spend", "0 joined from signups" | `65ac12c` |

Migration 249 on main: sha256 `689dea5e6120ab27119b81b022ea65c288848861b5798055d779af062936502d`, git blob `30c19f5a06b590e28769a5c11bc0f7eddfea3960`. Ops applies it from main.

## Signups at presale: where it reads from

- The figure stops at the day before presale and names that day: "Signups at presale · to Tue 4 Aug". The weekday is worked out from the date.
- CIRQLIN goes first. A CIRQLIN count of 0 stays 0.
- If no CIRQLIN count is dated on or before that day (no page, or a page launched after presale), the figure uses the Mailchimp tag's latest row stored on that day. It never uses today's count or a nearer day. With no row on that day, the figure is missing (`no_mailchimp_count_for_day`).
- The per-day Mailchimp writers all stamp `snapshot_at` at `${day}T12:00:00Z`, so a row's read time comes from `raw_json.source` (`mailchimpRowRead` in `lib/dashboard/presale/model.ts`):
  - `mailchimp_eod_cron`, `mailchimp_tag_daily_history`, `mailchimp_per_member_tag_history` and `mailchimp_api_daily_sync` are end-of-day reads.
  - `mailchimp_webhook_realtime` uses `raw_json.recomputed_at`.
  - `mailchimp_tag_sync` and other rows with a real `snapshot_at` use that instant.
- When the latest row isn't end of day, the label names its time in `events.event_timezone` (Europe/London when null): "to Tue 4 Aug, 13:00".

Charlotte de Witte (IRW0006, presale Wed 5 Aug 2026) reads 12,868 "to Tue 4 Aug" from the 4 Aug `mailchimp_eod_cron` row. The season report has 14,500.

## Open note (design, at the #1257 pass)

A 12:00 UTC tag row from an unknown source gets no time in its label, so it reads as the whole day. On 15 Nov 2026 the only such rows were 2 `manual_client_provided` rows on one event; no writer in the repo makes them. If a new writer stamps 12:00Z, add its source to the known-source list in `mailchimpRowRead`. Don't guess a time.

## Still open

- `events.presale_at` is unset on all six Ironworks shows. Until it's set, the presale log shows no figure tied to the open.
- Signup spend is Meta only. TikTok joins once HE6 stores TikTok's objective.
