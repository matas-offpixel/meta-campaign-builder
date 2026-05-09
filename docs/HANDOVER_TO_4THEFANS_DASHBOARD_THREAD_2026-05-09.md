# Handover → 4thefans Dashboard Thread (2026-05-09)

**From:** Commercial+Ops thread
**To:** 4thefans dashboard / creator-reporting thread
**Reason:** Manchester top-line resolver fix (PR #368) didn't take effect on the dashboard. Top-line still shows the latest fourthefans snapshot count (699) instead of the larger tier_channel_sales sum (1,362). Routing this back because the dashboard thread owns the resolver code and tested the equivalent path before — quicker to fix where the muscle memory is.

---

## What was supposed to happen (PR #368)

Replace the dashboard's per-event ticket-count source from "latest ticket_sales_snapshots row" to `Math.max(snapshot_tickets, tier_channel_sales_sum)`. Same logic for revenue.

Spec was: when tier_channel_sales has more tickets than the latest snapshot, use tier_channel_sales as the truth. This was meant to fix Manchester where xlsx-imported tier breakdown is richer than what fourthefans connector returns live.

## What's actually displayed right now

Manchester WC26 venue card on `/clients/[4tf-id]/dashboard` shows:

```
699 / 13,538 SOLD (5.2%)
£4,976 spent · 24% used · £7.12 CPT
Pacing: 329 tickets/day · £398/day to sell out
Total Revenue: not visible on top-line, but Event Breakdown table shows £6,334 (sum of 4 events × Eventbrite tier prices)
```

Per-event row in Event Breakdown:
- Croatia 246 / 3,246 · £2,188 revenue
- Ghana 71 / 800 · £924 revenue
- Panama 343 / 5,052 · £3,236 revenue
- Last 32 39 / 2,770 · £186 revenue

These numbers add to **699 tickets** (matching 246+71+343+39) and **£6,334 revenue**. Both come from the latest fourthefans `ticket_sales_snapshots` row + (snapshot.tickets × ticket_price) revenue calc — pre-PR #368 behaviour.

## What the data actually says (verified via Supabase MCP at 2026-05-09 18:30 UTC)

```
WC26-MANCHESTER tier_channel_sales (post-PR #368/#369 + cron sync):

Croatia    — 4TF: 482 + Venue: 120 = 602 tickets, £5,257 revenue
Ghana      — 4TF: 139 + Venue: 3   = 142 tickets, £1,886 revenue
Panama     — 4TF: 336 + Venue: 204 = 540 tickets, £4,984 revenue
Last 32    — 4TF: 78  + Venue: 0   = 78  tickets, £372  revenue
                                   ─────────────────────────────
                                   TOTAL: 1,362 tickets, £12,499 revenue
```

Latest ticket_sales_snapshots rows for the same 4 events are still 246/71/343/39 = 699 tickets, all `source='fourthefans'`.

So `Math.max(snapshot=699_total, tier_channel_sales_sum=1,362)` should resolve to **1,362 tickets / £12,499 revenue**. It's resolving to 699 / £6,334.

**The resolver isn't winning OR isn't being called on this surface.**

## Failure-mode hypotheses (in priority order — read these top-to-bottom)

### Hypothesis 1: PR #368 changed the resolver in one place but the venue-card top-line reads from a different code path

The dashboard's venue-card top-line ("Tickets" pill in Campaign Performance section) is rendered by **`displayVenueSpend`** + **`aggregateVenueCampaignPerformance`** in `components/share/client-portal-venue-table.tsx`. That code might have its own `tickets_sold` derivation that didn't get the resolver patch.

Check whether PR #368 actually touched `client-portal-venue-table.tsx` or only `lib/dashboard/portal-event-spend-row.ts`. If only the latter, the venue card top-line still reads from the old path.

Fast confirm: grep `Math.max` across the dashboard render path and confirm there are AT LEAST 3 callers (top-line tickets, top-line revenue, per-event row tickets, per-event row revenue). Currently I'd bet there's only 1-2.

### Hypothesis 2: PR #368 used `latestTicketSnapshotByEvent` as one input but tier_channel_sales as the other, and the tier_channel_sales sum at that map level is per-event not per-venue

The Manchester venue card aggregates 4 events into one "Depot Mayfield" row. If the resolver is per-event, Math.max picks 482>246 for Croatia, 142>71 for Ghana etc — but the venue-card sum still ends up at the venue-level rollup which might have been computed before the per-event Math.max ran.

Fast confirm: in `aggregateVenueCampaignPerformance`, log the input map shapes for Manchester. Make sure tier_channel_sales for each Manchester event was passed in, then summed AFTER the resolver per event.

### Hypothesis 3: The tier_channel_sales reads use the wrong client

Manchester tier_channel_sales rows now exist correctly under client `4thefans` (slug `4thefans`). If the dashboard loader is filtering tier_channel_sales by a wrong scope (e.g. by external_event_id which fourthefans connector uses, vs by event_id), the sum might come back as 0 — and `Math.max(699, 0) = 699`.

Fast confirm: in `loadPortalForClientId` paste a `console.log` for `tierChannelSales.filter(s => s.event_id IN [4 manchester ids])`. Should show 38 rows (sum of 14+6+13+2 per the per-event row counts seen earlier).

### Hypothesis 4: The Suspense-island shipped in PR #362 (loading.tsx + Suspense) is reading stale data because of the build_version cache mismatch

PR #362 added Suspense islands. If those islands cache their data via the build_version pattern (mig 067) and the most recent deploy didn't re-stamp the cache, an island might still be serving pre-resolver data.

Fast confirm: inspect the response payload from `/api/share/client/[token]` on the share endpoint vs the internal dashboard. If they differ, the internal route has the right resolver but the cached snapshot path on share doesn't.

### Hypothesis 5: PR #368's change actually wasn't deployed

Sometimes auto-merge says "merged" but the build that contains it hasn't reached production. Check Vercel Deployments → confirm the SHA for app.offpixel.co.uk includes #368's commit.

---

## Confirmed state to anchor your investigation

**Database (no fix needed — reads are intact):**

```sql
-- Manchester per-event tier_channel_sales (run this in Supabase MCP)
SELECT 
  e.name,
  SUM(tcs.tickets_sold) FILTER (WHERE tch.channel_name = '4TF') AS tcs_4tf,
  SUM(tcs.tickets_sold) FILTER (WHERE tch.channel_name = 'Venue') AS tcs_venue,
  SUM(tcs.tickets_sold) AS tcs_total,
  SUM(tcs.revenue_amount) AS tcs_revenue
FROM events e
LEFT JOIN tier_channel_sales tcs ON tcs.event_id = e.id
LEFT JOIN tier_channels tch ON tch.id = tcs.channel_id
WHERE e.event_code = 'WC26-MANCHESTER'
GROUP BY e.id, e.name
ORDER BY e.event_date;
```

Expected output (data is correct):
```
Croatia    482 / 120 / 602 / £5,257
Ghana      139 / 3   / 142 / £1,886
Panama     336 / 204 / 540 / £4,984
Last 32    78  / 0   / 78  / £372
```

**Latest ticket_sales_snapshots (all `source='fourthefans'`):**
- Croatia: 246 (2026-05-09 07:11 UTC)
- Ghana: 71 (2026-05-09 07:11 UTC)
- Panama: 343 (2026-05-08 22:03 UTC)
- Last 32: 39 (2026-05-09 07:07 UTC)

The `Math.max` per event should yield: 482, 139, 336, 78 (from 4TF channel alone) or 602, 142, 540, 78 (sum of 4TF + Venue). Either way Math.max should land on tier_channel_sales for all 4 events.

## CL Final on the same dashboard works correctly

CL Final London venue card on the dashboard ALREADY shows the correct backfilled tier_channel_sales numbers (PR #367 + mig 088). So the resolver IS firing on at least some venues. Manchester isn't. What's different about Manchester vs CL Final on the dashboard render path?

One known difference: Manchester is a **single venue with 4 events** (Depot Mayfield × 4 dates). CL Final is **4 venues with 1 event_code each** (Lock/Outernet/TOCA/Village all under 4TF26-ARSENAL-CL-FL). The aggregation code paths differ for single-venue-multi-event vs multi-venue-single-event_code.

The `aggregateVenueCampaignPerformance` and `displayVenueSpend` may handle these two shapes through separate branches — and PR #368's resolver landed in only one branch.

## Suggested fix scope (for whoever picks this up)

Smallest possible change:

1. Read the actual call graph from `client-portal-venue-table.tsx` for the Manchester case — log the inputs to whatever computes the venue-card "Tickets" and "Total Revenue" cells.
2. Confirm whether per-event Math.max runs before or after venue-level aggregation.
3. If after — the bug is order of operations; resolver runs but its output gets overwritten by a sibling path.
4. If before — verify tier_channel_sales sum is actually being passed to the resolver for Manchester events specifically.

Should be 1-2 hour fix once the actual path is identified.

## Why this happened despite PR #368 testing

The Cursor session's acceptance test confirmed Math.max picks 1,006 over 699 — but tested at the resolver level only. It didn't end-to-end test the dashboard render output. The session report said "Manchester WC26: resolver picks 1,006 tickets and £9,201 revenue over the 699-ticket snapshot aggregate" — that's a unit-level statement, not a dashboard-level one.

Lesson for memory: **for any dashboard-render fix, test at the rendered DOM level not just the resolver layer.** Add a Playwright/integration smoke test on the actual venue card.

## Files most likely involved

- `components/share/client-portal-venue-table.tsx` — venue card top-line render
- `lib/dashboard/portal-event-spend-row.ts` — per-event row resolver (PR #368's likely target)
- `lib/db/client-portal-server.ts` — `loadPortalForClientId` data loader
- `lib/dashboard/venue-stats-grid-aggregator.ts` — possibly the venue-card top-line aggregation

## What's NOT broken (don't touch)

- The 38 tier_channel_sales rows for Manchester. Data is correct.
- The fourthefans connector after PR #369 — it's now writing tier_channel_sales correctly (sums grew from 1,006 to 1,362 over the day).
- CL Final dashboard surface (correct, leave alone).
- Per-event row in Event Breakdown table — Croatia 246 / Ghana 71 etc are reading the snapshot path consistently, which is at least internally coherent. Just wrong vs reality.
- The PR #371 Cmd+K fix.

---

## Open follow-ups for this thread (post-fix)

1. **Outernet 1,351 / 1,357 question.** CL Final Outernet shows 1,351 tickets sold of 1,357 capacity — essentially sold out. Almost certainly the tier_channel_sales sum is double-counting across the 2 event_ticketing_links rows (pre-reg + on-sale). Verify by listing tier_channel_sales rows for Outernet and checking if the same tier_name appears multiple times under different listing IDs. If so, PR-3-style dedupe needed.

2. **Add an integration smoke test for venue-card dashboard render.** Lesson from this miss. Should at minimum assert that Manchester venue-card "Tickets" matches the SQL-verified tier_channel_sales sum.

3. **Memory anchor for future Cursor sessions:** "Resolver-level test is not dashboard-level test." Add to `feedback_*` memory.

---

Ping when fixed. I'll update the Commercial+Ops memory anchor and Joe walkthrough talking points accordingly.
