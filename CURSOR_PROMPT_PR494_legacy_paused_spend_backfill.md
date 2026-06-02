[Cursor, Sonnet] PR #494 — legacy paused-campaign spend backfill (5 WC26 venues)

## Context

5 WC26 venues are under-reporting Meta-direct spend on the dashboard by 22–30%:

| Venue       | Meta MCP (truth) | Dashboard | Drift   |
| ----------- | ---------------- | --------- | ------- |
| Aberdeen    | £2,459           | £1,897    | -£562   |
| Birmingham  | £3,384           | £2,496    | -£888   |
| Bournemouth | £3,278           | £2,426    | -£852   |
| Leeds       | £3,384           | £2,496    | -£888   |
| Newcastle   | £3,395           | £2,499    | -£896   |

Each venue has 1 ACTIVE campaign (in-window) + 2-3 PAUSED legacy campaigns from Jan–March 2026.

## Diagnosed root cause (already verified — do NOT re-debug)

`lib/dashboard/rollup-sync-runner.ts:397-407` sets `since = today - (60-1) days` for the live cron. `lib/insights/meta.ts:1963 fetchEventDailyMetaMetrics` then hits `/insights?level=campaign&time_range={since,until}`. Meta only returns rows for days inside `time_range`. Legacy paused campaigns whose spend all sits before 30 March 2026 (today - 60d) return zero rows → never enter `event_daily_rollups.ad_spend`.

The existing admin route `app/api/admin/event-rollup-backfill/route.ts` uses 90 days (line 319) which is also short — Aberdeen's oldest paused campaign created ~5 Feb 2026 = 113 days.

**Do NOT widen the live cron window.** PR #479 capped it at 60 days because Edinburgh hit Meta's 20-page × 500-row pagination ceiling and silently dropped newest dates. The fix is a one-shot historical backfill that runs offline, never on the hot path.

## What to build

A new admin route `app/api/admin/event-legacy-spend-backfill/route.ts` that:

1. POST body: `{ event_id: string }` (per-event) OR `{ client_id: string }` (whole client = all 5 WC26 venues for 4thefans). Mirror auth pattern from `event-rollup-backfill` (user session + ownership check; cron-secret for force mode).

2. For each in-scope event:
   - Resolve `event_code` + `ad_account_id` from the event/client.
   - Find earliest `campaign.start_time` for any campaign whose name contains `[${event_code}]` via Meta MCP equivalent (`/${account}/campaigns?fields=id,name,start_time,created_time&filtering=[{field:"campaign.name",operator:"CONTAIN",value:"[${event_code}]"}]&effective_status=["ACTIVE","PAUSED","ARCHIVED"]`). Note ARCHIVED inclusion — needed for fully-stopped legacy campaigns.
   - Compute `since = MIN(start_time, created_time)` floored to YYYY-MM-DD; `until = today - 60 days` (so we don't overlap the live cron's window and double-count).
   - If `since >= until`, skip — nothing to backfill (the live cron covers everything).
   - Call `fetchEventDailyMetaMetrics({ eventCode, adAccountId, token, since, until })` and upsert via `upsertMetaRollups` (same `MetaUpsertRow` shape as the existing backfill). DO NOT zero-pad — historical days with no spend should stay absent, not be force-written as 0 (that would clobber any future data and inflate row counts).
   - **Skip the allocator.** Allocator is for opponent attribution on shared venues. Legacy backfill on a paused campaign with no siblings = unnecessary and adds risk of double-counting against existing `ad_spend_allocated` rows. Just write raw `ad_spend`.

3. Response shape:

   ```json
   {
     "ok": true,
     "events_processed": 5,
     "results": [
       {
         "event_id": "...",
         "event_code": "WC26-ABERDEEN",
         "window": { "since": "2026-02-05", "until": "2026-03-29" },
         "campaigns_seen": 4,
         "rows_written": 23,
         "spend_added_gbp": 562.14
       }
     ]
   }
   ```

4. Add the route's prefix to `lib/auth/public-routes.ts` PUBLIC_PREFIXES so the cron-secret bearer path works (per `feedback_middleware_swallows_bearer_auth`).

5. Smoke test by:
   - Running with `event_id` = WC26-ABERDEEN's event UUID.
   - Querying Supabase: `SELECT SUM(ad_spend) FROM event_daily_rollups WHERE event_id = '<uuid>'` — should now sum to ~£2,459 per fixture (matching Meta MCP).
   - Cross-checking ONE other venue (Birmingham) same shape.

## Anti-drift rules (per memory)

- DO NOT modify `fetchEventDailyMetaMetrics`, `rollup-sync-runner.ts`, or `venue-spend-allocator.ts`. Live cron path is correct as-is.
- DO NOT change the 60-day cap in `MAX_ALLOCATOR_BACKFILL_DAYS`. That cap is load-bearing — PR #479 fixed Edinburgh silent-drop.
- DO NOT widen the existing `event-rollup-backfill` window from 90 → anything. Build a new route.
- Verify the in-prod fix with Supabase MCP before opening PR — print the per-event `SUM(ad_spend)` diff before/after.
- Branch: `cursor/legacy-paused-spend-backfill`. Single PR. cc/ branch prefix is ours, cursor/ is yours.

## Why this is the right shape

- One-shot historical write — runs at most quarterly when a new client onboards or stale paused-campaign spend matters.
- Live cron stays narrow → preserves PR #479's silent-drop fix.
- No window-widening creep. No status-filter changes that could leak into other surfaces.
- Backfill writes are date-scoped to days the live cron will never re-touch (`until = today - 60`) → zero risk of write-collision on future syncs.

## Verification before merge

1. Run against all 5 venues; print before/after `SUM(ad_spend)` per `event_id`.
2. Confirm dashboard Performance Summary spend column matches Excel within £5 for each venue.
3. Confirm Glasgow venues (PR #493 split scope) are NOT affected — they're not in the 5 venues, and this backfill is per-event_code so it touches only the events you POST.
4. `npm run lint && npm run build` pass.
