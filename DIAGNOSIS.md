# Venue Spend Allocator Stall — Diagnostic (Edinburgh, since 2026-05-23)

**Branch:** `cc/venue-spend-allocator-stall-diagnostic`
**Author:** Claude Code (Opus 4.7, 1M context), diagnose-first per Matas's brief
**Date:** 2026-05-28
**Scope:** Diagnose-only. No code in this PR.

---

## TL;DR

- The cron IS running. The Meta CAMPAIGN-level leg IS writing raw `ad_spend` to Edinburgh's rollup rows on 23–28 May. What stopped on 23 May is specifically `event_daily_rollups.ad_spend_allocated` (and its `_specific` / `_generic_share` siblings) — the columns the **per-ad** allocator owns.
- **Only `WC26-EDINBURGH` is affected.** No other multi-fixture venue has a non-trivial `last_raw_adspend - last_allocated` gap. This is venue-specific, not a global allocator regression.
- **No PR in the 18–24 May window touched the allocator or its writer.** Both PRs that did touch the rollup write path (#468 on 26 May, #472 on 28 May) landed AFTER the 23 May stall — ruled out as triggers.
- **Leading hypothesis: silent pagination cap on Meta's ad-level Insights fetch.** `resolveAllocatorSince` (PR #158, 29 Apr) extends the allocator's fetch window backwards to the earliest date with a non-null `ad_spend_allocated` or `ad_spend_presale` row. For Edinburgh, that's **2025-11-30 → 180 days**, vs. the parent runner's 60-day window. The ad-level fetch caps at 20 pages × 500 rows = 10,000 rows. Meta returns rows in date-ascending order, so a cap hit silently drops the newest dates. Edinburgh crossed that ceiling at some point on/around 23 May.
- **Fix shape (not code):** bound `resolveAllocatorSince`'s extension to the parent runner's rolling window (or a similar cap, e.g. 90 days). Re-syncing missing historical days is the job of an admin backfill route, not the live cron, which only needs the ~60-day live window the rest of the pipeline already uses.

---

## 1. Last successful allocator write

Per `event_daily_rollups` for the three Edinburgh fixtures:

| Event | Last `ad_spend_allocated` | Last `ad_spend` (raw) | Last `ad_spend_presale` | Latest row |
|---|---|---|---|---|
| Scotland v Haiti (owner, `296e6bdc…`) | **2026-05-22** | 2026-05-28 | 2026-01-26 | 2026-05-28 |
| Scotland v Brazil (`4749f1c4…`) | **2026-05-22** | 2026-05-28 | 2026-01-26 | 2026-05-28 |
| Scotland v Morocco (`530ae3b4…`) | **2026-05-22** | 2026-05-28 | 2026-01-26 | 2026-05-28 |

All three siblings stopped on the same day, in lockstep — consistent with a single failed run, not three independent failures. Brief confirmed: 22 May is the last successful write.

Day-by-day around the edge:

| Date | `ad_spend` (raw, ×3 fanout) | `ad_spend_allocated` (per sibling) |
|---|---|---|
| 2026-05-19 | £60.13 | £20.04 ✓ |
| 2026-05-20 | £51.37 | £17.12–17.13 ✓ |
| 2026-05-21 | £63.59 | £21.20 ✓ |
| 2026-05-22 | £69.27 | £16.52–16.53 ✓ |
| 2026-05-23 | £61.25 | **NULL** ✗ |
| 2026-05-24 | £78.36 | **NULL** ✗ |
| 2026-05-25 | £66.06 | **NULL** ✗ |
| 2026-05-26 | £52.35 | **NULL** ✗ |
| 2026-05-27 | £61.24 | **NULL** ✗ |
| 2026-05-28 | £28.40 | **NULL** ✗ |

Stalled-day raw spend totals £347.66/sibling × 3 = ~£1,043 unallocated (matches the "~5–6 days × ~£200/day" estimate in the brief, allowing for fanout).

`updated_at` on the stalled rows is **2026-05-28** (today) — so the cron DID process Edinburgh today and overwrote `ad_spend`, but didn't write the allocator columns for those dates. The 19–22 May rows also have `updated_at = 2026-05-28`, proving the allocator wrote those dates today but not the newer ones — strongly consistent with the pagination-cap hypothesis below.

## 2. Cron / scheduler state — IS firing

Three pieces of independent evidence the cron is alive and processing Edinburgh on 2026-05-28:

1. `event_daily_rollups.updated_at = 2026-05-28T15:36` on Brazil/Morocco rows for the stalled dates — the cron wrote `ad_spend` and `ad_spend_presale` today.
2. The owner row (Scotland v Haiti) shows `updated_at = 14:14`, the non-owner rows show `15:36` — consistent with the post-#472 owner-write-first path, hit twice (once when the cron processed Haiti, once when it processed each of the two non-owners; the allocator runs from each event's perspective and writes all siblings).
3. The 19–22 May rows have allocator columns populated and `updated_at = 2026-05-28T15:36`, proving today's run successfully wrote `ad_spend_allocated` for THOSE dates. Same run, same code path, same Meta fetch — only the newest dates fell off.

Vercel runtime log search for `[venue-spend-allocator]` / `WC26-EDINBURGH` / `cron rollup-sync-events` over the last 24 h returned no results for substring queries (the MCP query consistently timed out before paging through results). The DB-side evidence is strong enough on its own that I did not chase log retrieval further — but a manual review of the most recent `[venue-spend-allocator] phase-split event_code=WC26-EDINBURGH … ads_total=N` log line would confirm `ads_total` and the `window=…` to-from dates, which is the single highest-value next observation.

## 3. Suspect PRs in the 18–24 May window — none plausible

`git log --since=2026-05-15 --until=2026-05-30` against the allocator-adjacent files:

| File | Touching PRs in window |
|---|---|
| `lib/dashboard/venue-spend-allocator.ts` | none |
| `lib/dashboard/venue-spend-allocation.ts` | none |
| `lib/dashboard/rollup-sync-runner.ts` | #468 (2026-05-26), #472 (2026-05-28) |
| `lib/db/event-daily-rollups.ts` | #468 (2026-05-26), #472 (2026-05-28) |
| `lib/insights/meta.ts` | #468 (2026-05-26) |
| `app/api/cron/rollup-sync-events/route.ts` | none |
| `lib/dashboard/cron-eligibility.ts` | none |
| `lib/dashboard/venue-allocator-trigger.ts` | none |
| `lib/dashboard/venue-equal-split.ts` | none |

Both PRs that touched the rollup writer path landed **after** the 23 May stall:

- **PR #468 (canonical clicks + LPV, 26 May).** Added `landing_page_views`, swapped `inline_link_clicks → clicks`. Touches the Meta-leg fetcher and `upsertMetaRollups`. Cannot have caused a 23 May regression (post-dates the stall). Verified the LPV path doesn't gate on engagement columns from non-owner siblings; the allocator does not consume LPV.
- **PR #472 (R2a engagement-owner fanout collapse, 28 May).** Introduced the `ownedOrNull` projection so non-owner siblings write NULL on engagement columns. Cannot have caused a 23 May regression (also post-dates). Verified the allocator does NOT read any column that PR #472 made nullable — it consumes ad-level fetch results from Meta, not rollup rows for its inputs. The only allocator read of rollup state is `resolveAllocatorSince`, which checks `ad_spend_allocated` / `ad_spend_presale` (both allocator-owned columns, untouched by #472).

**Conclusion: this is not a code regression triggered by a recent merge.** Something changed in the data shape (most likely: the size of Edinburgh's ad-level corpus crossed a fetch-volume threshold) around 23 May.

## 4. Input data — Meta is delivering campaign-level spend, NOT ad-level rows for recent dates

- Raw `ad_spend` is populated for **every** Edinburgh date 19–28 May. This is written by the **campaign-level** Meta leg (`upsertMetaRollups` via the main fetch path). Confirms the Meta API + ad account + token are healthy for Edinburgh.
- `ad_spend_presale` is populated (= 0.00) for the 23–28 May rows, also written by the Meta leg.
- `ad_spend_allocated` is NULL specifically on 23–28 May. This column is owned solely by the **ad-level** Meta fetch (`fetchVenueDailyAdMetrics` in `lib/insights/meta.ts:3012`) which the allocator drives in `allocateVenueSpendForCode` (`lib/dashboard/venue-spend-allocator.ts:687`).
- The shape `raw filled + allocated null` for the same date can only be produced if the day was NOT in the allocator's `activeDays` set (`venue-spend-allocator.ts:823`) — i.e., the ad-level fetch returned zero rows for that day. If the fetch returned ≥1 ad row, an upsert payload would be built with `ad_spend_allocated = round2(r.allocated)` (which can be 0, but is never NULL). The "NULL" symptom is therefore proof that **no ad-level row came back from Meta for those days, in those runs**.

So the cause is upstream of any database write: the Meta ad-level fetch is dropping the recent dates.

## 5. Silent-skip guards — three candidates, one likely

In order from least to most likely:

### 5a. `try/catch` swallow of allocator failures (unlikely)
`rollup-sync-runner.ts:895-907` wraps `allocateVenueSpendForCode` in `try/catch` and only `console.error`s on throw. But the allocator itself wraps everything that can throw (sibling lookup, Meta fetch, per-day classifier) and returns a result object. A swallowed throw would mean the whole allocator failed for Edinburgh — but the 19–22 May rows updated today prove the allocator successfully ran end-to-end and called `upsertAllocatedSpendRollups`. Not the cause.

### 5b. Per-ad classification errors (unlikely)
The allocator pushes malformed ads into `classificationErrors` and drops them (`venue-spend-allocator.ts:741-746`). A `classify_day_failed` (lines 843-867) would fall through with zero on-sale allocation for that day BUT still write a row (with `ad_spend_allocated = 0`, not NULL). Same logic for the click-day path. Would produce `allocated=0`, not `allocated=NULL`. Not the cause.

### 5c. `activeDays` excludes the date because Meta returned no ad-level rows for it — LIKELY
This is the silent-skip mechanism that matches the symptom exactly. `activeDays` (line 823) is the union of `onsaleByDay.keys()` + `presaleByDay.keys()` + the two `*Clicks` maps — all populated only from `adFetch.rows`. A day with zero rows in `adFetch.rows` is silently absent from `activeDays`, the per-day loop never runs for it, no upsert payload is built for it, and the row keeps `ad_spend_allocated = NULL`.

There is **no log line** that announces "0 ad rows returned for day X" — the diagnostic granularity is venue-wide (`phase-split event_code=… ads_total=N`). If Meta returned, say, 4,000 rows total but those cover only 19–22 May, you get `ads_total=4000` in logs and the missing dates are invisible.

## Why the ad-level fetch is dropping recent dates — most likely cause

`fetchVenueDailyAdMetricsForBracket` (`lib/insights/meta.ts:3079`) paginates the ad-level call with `limit: "500"` and a `for (let page = 0; page < 20; page += 1)` cap → **hard ceiling of 10,000 rows per call**. There is no log when this ceiling is hit; the loop just `break`s on the page-20 boundary.

`resolveAllocatorSince` (`venue-spend-allocator.ts:1044-1073`, added in PR #158 on 2026-04-29) extends the fetch window backwards to the earliest rollup row with a non-null `ad_spend_allocated` or `ad_spend_presale`. For Edinburgh, that's **2025-11-30** (180 days back). The parent runner's window is 60 days (`rollup-sync-runner.ts:384`, `windowDays = 60`). So the allocator's `effectiveSince` is ~120 days earlier than the runner's `sinceStr`.

Meta's `/insights` endpoint returns time-incremented rows in date-ascending order (older first). When the 20-page cap fires before the cursor reaches the most recent days, **the newest dates are the ones silently dropped** — exactly the symptom.

Edinburgh-only fits: 3 fixtures × multiple opponent campaigns × presale period since Nov-2025 × an active on-sale corpus produces more ad-level rows than any other current venue. The 23 May cliff is where Edinburgh's accumulated ad count crossed the 10,000-row ceiling on the 180-day window.

This is consistent with the "Edinburgh-only" outcome from the cross-venue query (no other multi-fixture venue's `last_raw_adspend - last_allocated` exceeds zero by more than a day). Other venues are smaller, so they fit under the cap.

### Alternative causes (lower probability, still worth confirming)

A. **Meta API rate limit during this venue's call.** Would produce a 4xx/throw that `handleMetaError` catches (returns `{ok: false}`), and the allocator would early-return `meta_fetch_failed` for the WHOLE call. That would null-out 19–22 May too, not just 23–28. Doesn't match.

B. **New campaign created after 22 May with non-bracketed name.** The case-sensitive post-filter (`campaignMatchesBracketedEventCode`) would drop ads from such a campaign. But the **same filter** is applied to the campaign-level fetch driving raw `ad_spend` — and raw `ad_spend` is being written through today. So the bracket filter is matching SOMETHING for those dates. Possible but unlikely.

C. **Meta returning ad-level rows for newer dates but ALL with `campaignPhase === "presale"`.** Would route everything to the presale bucket and write `ad_spend_allocated = 0`, not NULL. Doesn't match (allocated is NULL, not 0).

## Recommended fix shape — DO NOT IMPLEMENT IN THIS PR

The smallest defensible fix is to cap `resolveAllocatorSince`'s extension so the allocator's fetch window can't grow beyond the parent runner's window (or beyond a hard maximum, e.g. 60–90 days). The historical presale backfill that PR #158 enabled belongs in an admin backfill route, not the live cron — keeping the live path to 60 days fits comfortably under the 10,000-row ceiling for every current venue.

```
// shape sketch — not code; for the implementer to consider
const MAX_ALLOCATOR_BACKFILL_DAYS = 60; // or 90
const minSince = ymdDaysAgo(today, MAX_ALLOCATOR_BACKFILL_DAYS);
return effectiveSince < minSince ? minSince : effectiveSince;
```

Belt-and-braces additions worth bundling with the fix:

1. **Log when the 20-page pagination cap fires** in `fetchVenueDailyAdMetricsForBracket`. Currently silent. A one-line `console.warn` makes a recurrence visible in <5 minutes instead of the 5+ days it took to notice this one (memory note `feedback_supabase_postgrest_1k_cap.md` documents the same class-of-bug pattern on the Supabase side — same lesson applies to upstream API pagination).
2. **Log `activeDays` size + min/max date** in the `phase-split` line in `venue-spend-allocator.ts:773`. Today the line carries `ads_total` but not the date range covered — a future cap-hit on a different venue would be invisible to log inspection.
3. **One-shot SQL backfill** to fill in the 23–28 May allocator columns for Edinburgh once the fix lands. Either:
   - manual SQL with the SAME shape as PR #472's `/api/admin/rollup-engagement-fanout-collapse` (split raw `ad_spend` evenly across the 3 siblings since this venue is allocator-equal-split candidate post-cap-fix), OR
   - re-run the live cron after deploying the fix and verify `ad_spend_allocated` populates organically.

Either is fine; the live re-sync is simpler if the fix is correct.

## Handover

This branch contains only this `DIAGNOSIS.md`. No code changes. Per Matas's brief: do not implement in this PR — decide who continues (Claude Code or Cursor) after reading. If continuing as Claude Code, the implementation branch should be a fresh `cc/venue-spend-allocator-window-cap-fix` off main; if handing to Cursor, this branch can be closed and reopened as `cursor/...`. Either way, leave this PR open as the diagnostic artifact (the rationale-for-the-fix doc) and reference it from the implementation PR.

---

## Appendix — queries used

```sql
-- Per-sibling last-allocated / last-raw vs last-presale
WITH eds AS (SELECT id AS event_id, name FROM events WHERE event_code = 'WC26-EDINBURGH')
SELECT e.event_id, e.name,
  MAX(r.date) FILTER (WHERE r.ad_spend_allocated IS NOT NULL) AS last_allocated_date,
  MAX(r.date) FILTER (WHERE r.ad_spend IS NOT NULL AND r.ad_spend > 0) AS last_raw_adspend_date,
  MAX(r.date) FILTER (WHERE r.ad_spend_presale IS NOT NULL AND r.ad_spend_presale > 0) AS last_presale_date,
  MAX(r.date) AS last_any_row
FROM eds e LEFT JOIN event_daily_rollups r ON r.event_id = e.event_id
GROUP BY e.event_id, e.name ORDER BY e.event_id;

-- Day-by-day Edinburgh state
WITH eds AS (SELECT id AS event_id, name FROM events WHERE event_code = 'WC26-EDINBURGH')
SELECT r.date, e.name, r.ad_spend, r.ad_spend_allocated, r.ad_spend_presale,
  r.ad_spend_specific, r.ad_spend_generic_share, r.link_clicks, r.updated_at
FROM eds e JOIN event_daily_rollups r ON r.event_id = e.event_id
WHERE r.date BETWEEN '2026-05-19' AND '2026-05-28' ORDER BY r.date, e.name;

-- Is this Edinburgh-only or systemic?
WITH per_code AS (
  SELECT e.event_code, COUNT(DISTINCT e.id) AS sibling_count,
    MAX(r.date) FILTER (WHERE r.ad_spend_allocated IS NOT NULL) AS last_allocated,
    MAX(r.date) FILTER (WHERE r.ad_spend IS NOT NULL AND r.ad_spend > 0) AS last_raw_adspend
  FROM events e LEFT JOIN event_daily_rollups r ON r.event_id = e.id
  WHERE e.event_code IS NOT NULL GROUP BY e.event_code
)
SELECT event_code, sibling_count, last_allocated, last_raw_adspend,
  (last_raw_adspend - last_allocated) AS days_stalled
FROM per_code
WHERE last_raw_adspend IS NOT NULL AND last_allocated IS NOT NULL
  AND last_raw_adspend > last_allocated
ORDER BY (last_raw_adspend - last_allocated) DESC, event_code LIMIT 30;

-- Allocator's effective fetch window after resolveAllocatorSince
WITH eds AS (SELECT id FROM events WHERE event_code = 'WC26-EDINBURGH')
SELECT
  MIN(r.date) FILTER (WHERE r.ad_spend_allocated IS NOT NULL OR r.ad_spend_presale IS NOT NULL) AS earliest_allocator_or_presale_date,
  COUNT(DISTINCT r.date) FILTER (WHERE r.ad_spend_allocated IS NOT NULL OR r.ad_spend_presale IS NOT NULL) AS allocator_or_presale_distinct_days,
  COUNT(*) AS total_rows
FROM event_daily_rollups r WHERE r.event_id IN (SELECT id FROM eds);
```

## Appendix — key file:line refs

- `lib/dashboard/venue-spend-allocator.ts:687` — `fetchVenueDailyAdMetrics` call (the ad-level fetch driving allocator inputs)
- `lib/dashboard/venue-spend-allocator.ts:823` — `activeDays` (the silent-skip set)
- `lib/dashboard/venue-spend-allocator.ts:898-930` — per-day upsert payload build (only fires for dates in `activeDays`)
- `lib/dashboard/venue-spend-allocator.ts:1044-1073` — `resolveAllocatorSince` (window-extension helper, PR #158)
- `lib/insights/meta.ts:3079` — `fetchVenueDailyAdMetricsForBracket` (the 20-page × 500-row pagination)
- `lib/insights/meta.ts:3099` — the `for (page = 0; page < 20; page++)` cap (silently breaks at page 20)
- `lib/dashboard/rollup-sync-runner.ts:384` — parent runner's `windowDays = 60`
- `lib/db/event-daily-rollups.ts:731` — `upsertAllocatedSpendRollups` (no guard; cleanly writes whatever rows it's given)
