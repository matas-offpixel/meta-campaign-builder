# Session log — PR pending: legacy-paused-spend-backfill

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/legacy-paused-spend-backfill`

## Summary

Adds `app/api/admin/event-legacy-spend-backfill/route.ts` — a one-shot admin
route that backfills Meta spend for legacy paused campaigns whose activity
pre-dates the live cron's 60-day window. Five WC26 venues (Aberdeen,
Birmingham, Bournemouth, Leeds, Newcastle) were under-reporting Meta spend
by £562–£896 per fixture because 2–3 paused campaigns each had their full
spend history before the live cron's reach. The fix is a narrow historical
write (`since = MIN(campaign.start_time)` → `until = today - 60d`) that is
disjoint from the live cron window and never calls the allocator, keeping the
hot path untouched.

## Scope / files

- `app/api/admin/event-legacy-spend-backfill/route.ts` — new route (POST)
- `lib/auth/public-routes.ts` — carve-out for bearer-only curls (same pattern
  as every prior admin backfill route)

## Design decisions

- **Window**: `since = MIN(start_time, created_time)` across all campaigns
  matching `[EVENT_CODE]` with `effective_status ∈ {ACTIVE, PAUSED, ARCHIVED,
  DELETED}`. `until = today − 60d` (live cron's first day is today − 59d, so
  the two windows are disjoint).
- **No zero-padding**: historical days with no spend stay absent. Zero-padding
  would clobber future live-cron rows if run again.
- **No allocator**: paused legacy campaigns have no siblings in-window; running
  the allocator would add risk with no benefit.
- **Auth**: `event_id` mode uses user session + ownership check (mirrors
  `event-rollup-backfill`). `client_id` mode requires Bearer `CRON_SECRET`.
  Only the 4theFans client is allowed in `client_id` mode for now.
- **DO NOT** modify `fetchEventDailyMetaMetrics`, `rollup-sync-runner.ts`, or
  `venue-spend-allocator.ts`. All three are correct as-is.

## Before state (captured 2026-05-29 via Supabase MCP)

Per event_code, sum across all fixtures:

| event_code       | fixtures | total_ad_spend (£) | oldest_rollup |
|------------------|----------|--------------------|---------------|
| WC26-ABERDEEN    | 3        | 5,691.07           | 2026-02-28    |
| WC26-BIRMINGHAM  | 4        | 9,984.00           | 2026-01-29    |
| WC26-BOURNEMOUTH | 4        | 10,036.52          | 2026-01-29    |
| WC26-LEEDS       | 4        | 8,160.57           | 2026-01-29    |
| WC26-NEWCASTLE   | 4        | 10,867.99          | 2026-01-29    |

Aberdeen oldest rollup is 2026-02-28. Campaign created ~2026-02-05 (23-day gap).
Other venues have rollups back to 2026-01-29 but PAUSED legacy campaigns may
have started before that date.

## After state

Run the route with `{ "client_id": "37906506-56b7-4d58-ab62-1b042e2b561a" }`
and bearer `CRON_SECRET`, then re-run:
```sql
SELECT e.event_code, COUNT(DISTINCT e.id) AS fixtures,
       ROUND(SUM(r.ad_spend)::numeric, 2) AS total_ad_spend,
       MIN(r.date) AS oldest_rollup
FROM events e
LEFT JOIN event_daily_rollups r ON r.event_id = e.id
WHERE e.event_code IN ('WC26-ABERDEEN','WC26-BIRMINGHAM',
                       'WC26-BOURNEMOUTH','WC26-LEEDS','WC26-NEWCASTLE')
GROUP BY e.event_code ORDER BY e.event_code;
```
Expected: totals rise to match Meta MCP truth (Aberdeen ~£7,377, Birmingham
~£13,536, etc.). Per-fixture expected values: Aberdeen ~£2,459, Birmingham
~£3,384, Bournemouth ~£3,278, Leeds ~£3,384, Newcastle ~£3,395.

## Smoke-test curl (post-deploy)

```bash
# Per-event (user session required)
curl -X POST https://<preview>/api/admin/event-legacy-spend-backfill \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{"event_id": "60f1a152-8d01-4147-bbd2-1fa57b4745a1"}'

# Whole-client (bearer auth)
curl -X POST https://<preview>/api/admin/event-legacy-spend-backfill \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"client_id": "37906506-56b7-4d58-ab62-1b042e2b561a"}'
```

## Anti-drift checklist

- [x] Did NOT modify `fetchEventDailyMetaMetrics`
- [x] Did NOT modify `rollup-sync-runner.ts`
- [x] Did NOT modify `venue-spend-allocator.ts`
- [x] Did NOT change the 60-day live-cron cap
- [x] Did NOT widen `event-rollup-backfill` window
- [x] No zero-padding in upsert
- [x] `until = today - 60d` (disjoint from live cron)
- [x] Glasgow venues NOT affected (not in the 5 venues; backfill is event_code scoped)

## Validation

- [x] `npx tsc --noEmit` — no new errors in modified files
- [x] `npx eslint route.ts lib/auth/public-routes.ts` — clean
- [x] No changes to live cron path
