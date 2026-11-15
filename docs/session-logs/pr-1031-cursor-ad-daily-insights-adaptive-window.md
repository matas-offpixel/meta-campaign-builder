# ad_daily_insights: adaptive window per account

## PR

- **Number:** 1031
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1031
- **Branch:** `cursor/ad-daily-insights-adaptive-window`

## Summary

`GET /act_1967530076312/insights` (`level=ad`, `time_increment=1`) failed on every 7-day window with Meta "An unknown error occurred", and once with "Service temporarily unavailable". The same request for one day succeeded. The cron's 3-day window was likely to fail the same way. Each account's window is now split 7 → 3 → 1 days whenever a span fails with Meta code 1/2, or with reduce-data at the smallest page size. Each smaller span is tried once, and a failure at 1 day records `error` with the Meta code, subcode and message. The cron runner and the backfill script share one function, `fetchAdAccountInsightsAdaptive`.

A span's rows are written only after every page of that span has been read. Before this change, the runner upserted partial pages from a failed account ("Partial pages … are still facts; keep them"), which is how 100 rows from a failed window were written.

## Reproduction (read-only, one call, 7 Oct 2026)

- **Request:** `GET /act_1967530076312/insights` with the cron's params, `time_range` 2026-09-30..2026-10-06, `limit=100`, `maxAttempts: 1`.
- **Result:** it did **not** reproduce. HTTP 200 returned 100 rows and a `paging.next` cursor, so there is no Meta error payload to record from this call.
- **Reading:** the 7-day failure is not on page 1 at `limit=100`. It is on a later page, or on the first `limit=500` call that triggers the step-down. That fits the 100 partial rows that were written: page 1 succeeded and a later page failed. The splitter treats both cases the same way, and drops the partial span.

## Behaviour

- **Spans:** `insightsSpans(since, until, 7)` cuts the window first. A splittable failure cuts the failing span into the next smaller size from `AD_INSIGHTS_WINDOW_DAYS = [7, 3, 1]`.
- **Splittable errors:** Meta code 1 or 2, or `isReduceDataError` after the 500 → 100 → 25 page step-down.
- **No split:** auth, rate-limit and any other code stop the account immediately, with no split.
- **Giving up:** a splittable failure at 1 day stops the account with `status: "error"` and `error: "<since>..<until>: Meta code=1 subcode=99: …"`. Spans that already finished stay written.
- **Call counting:** every call is counted in `calls` and `meta_calls`. The worst case for a 7-day window is 1 call at 7 days, 3 at 3 days and 7 at 1 day, plus any page step-down calls.
- **Logging:** `[ad-daily-insights] <account> window_split=<from>d→<to>d status=… meta_calls=…`. The backfill prints `window_split=` per window. `AccountOutcome.windowSplit` carries the same range.

## Scope / files

- `lib/ad-daily-insights/fetch.ts`: `fetchAdAccountInsightsAdaptive`, `insightsSpans`, `AD_INSIGHTS_WINDOW_DAYS`, `splittable` on `AccountFetchResult`, and the Meta code and subcode in the error text.
- `lib/ad-daily-insights/runner.ts`: per-span upsert through `onSpan`, `windowSplit` on the outcome, and the `window_split` log line.
- `scripts/backfill-ad-daily-insights.mts`: uses `insightsSpans` instead of its own window cutter, prints `window_split`, and has an updated call estimate.
- `lib/ad-daily-insights/__tests__/adaptive-window.test.ts` (new).

## Tests

`adaptive-window.test.ts`:

- `insightsSpans` cuts a range into consecutive spans of at most N days.
- Fails at 7 and 3 and succeeds at 1: all 10 calls are counted, each day is written once, and the log shows `window_split=7d→1d`.
- The cron's 3-day window splits 3d→1d.
- Succeeds at 7: one call, one write, no split.
- Auth and rate-limit errors stop the account without splitting.
- An error that is not code 1/2 or reduce-data does not split.
- Reduce-data after the smallest page size splits the window.
- A page that fails mid-span drops that span's earlier pages; nothing from it is written.
- At 1 day it gives up with `error` and the Meta code, keeps finished spans, and stops.
- The backfill script splits through the same runner and cuts its windows with `insightsSpans`.

## Validation

- [x] `npm test`: 6,801 node tests and 8 vitest pass.
- [x] `npm run build`
- [x] `npx tsc --noEmit`: no errors in touched files.
- [x] `eslint` on touched files.

## Notes

- No migration and no Meta writes.
- Rows already written from the failed window on 7 Oct are not deleted. They are real ad-days for the dates they cover, and the next run that reads those days in full upserts over them.
