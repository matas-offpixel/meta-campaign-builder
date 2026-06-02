```
[Cursor, Sonnet] — branch `cc/presale-clobber-fix`

## Goal
Fix the 3× presale-spend over-attribution on multi-fixture venues (WC26-EDINBURGH is the symptom case). The Meta leg writes the full venue-total `ad_spend_presale` to every sibling event row, then the allocator runs ONCE per (client_id, event_code) batch and divides correctly. But because the next sibling's rollup-sync invocation re-runs the Meta leg (which clobbers `ad_spend_presale` back to the venue total) and the allocator is gated by `shouldSkipVenueAllocatorBatch`, only the FIRST sibling ends up with the divided value. Siblings 2..N keep the venue total, giving 3× the truth.

Verified on prod (2026-06-02):
- Meta MCP truth for WC26-EDINBURGH PRESALE campaign on 2026-01-24 = £145.23 venue total.
- DB: all 3 Edinburgh siblings show `ad_spend_presale = £145.23` for that day → SUM across siblings = £435.69 (3×).
- Lifetime: `SUM(ad_spend_presale)` across 3 events = £1,345.74; truth = £448.58.
- Dashboard "PAID MEDIA spent £8,482" is overstated by £897 vs Meta truth (£7,547.83).

Allocator code in `lib/dashboard/venue-spend-allocator.ts` is already correct (lines 833–836 `presaleShare = presaleDayTotal / eventCount`). The fix is to stop the Meta leg from writing `ad_spend_presale`.

## Files to change

### 1. `lib/db/event-daily-rollups.ts`
In `upsertMetaRollups` (around line 359), remove `ad_spend_presale` from the upsert payload (line 388) and from the `metaDataMatch` comparator (line 344). `ad_spend_presale` is allocator-owned; the Meta leg must not touch it.

Also update the `MetaUpsertRow` interface (line 291): mark `ad_spend_presale` as deprecated/unused or remove it entirely. If removing, update the JSDoc on lines 261–268 that mentions it.

### 2. `lib/dashboard/rollup-sync-runner.ts`
Around line 575–578, the Meta-leg builder populates `metaByDate` with `ad_spend_presale: d.presaleSpend ?? 0`. Drop that field from the map's value type and from every place that constructs an entry (lines 575, 655, 675). Also remove the snapshot read at 657. The presale column is now exclusively allocator-written.

### 3. Tests
- Update `lib/db/__tests__/upsert-noop-guard.test.ts` to drop `ad_spend_presale` from the Meta-leg test fixtures.
- Add a regression test in `lib/dashboard/__tests__/venue-spend-allocator.test.ts` (or create one if missing) asserting that for a WC26 opponent-allocator venue with 3 siblings and £150/day presale spend on one day, the resulting per-event `ad_spend_presale` is £50, not £150. Use a Supabase mock + mocked `fetchVenueDailyAdMetrics`.

### 4. Backfill migration
Add `supabase/migrations/NNN_recompute_allocator_owned_columns.sql` (claim the next integer with `ls supabase/migrations/ | tail -1`). The migration should zero out `ad_spend_presale` on rows that have it set BUT for an event_code whose siblings disagree on the per-day value (i.e. proof of the clobber pattern). Don't blanket-zero — solo events (`solo_pass_through`) correctly have the full value.

Recommended SQL approach (verify on a branch DB first):
```sql
-- For each (event_code, date), if siblings differ on ad_spend_presale,
-- zero it out so the next allocator run sets the divided value.
WITH bad_days AS (
  SELECT e.event_code, r.date
  FROM events e
  JOIN event_daily_rollups r ON r.event_id = e.id
  WHERE r.ad_spend_presale IS NOT NULL AND r.ad_spend_presale > 0
  GROUP BY e.event_code, r.date
  HAVING COUNT(DISTINCT e.id) > 1
     AND COUNT(DISTINCT r.ad_spend_presale) = 1  -- all siblings same → clobbered
     AND COUNT(DISTINCT e.id) > 1
)
UPDATE event_daily_rollups r
SET ad_spend_presale = 0
FROM events e, bad_days b
WHERE r.event_id = e.id
  AND e.event_code = b.event_code
  AND r.date = b.date;
```

### 5. Trigger a resync to repopulate
After merge + migration, POST to `/api/admin/event-rollup-backfill` for all multi-fixture venues to let the allocator write correct `ad_spend_presale` values. Don't run from Cursor — Matas will trigger it.

## Validation gate
1. Run `npm run lint && npm test`.
2. Unit test from §3 passes.
3. On a Supabase branch, apply the migration, run rollup-sync for WC26-EDINBURGH, and confirm:
   ```sql
   SELECT SUM(ad_spend_presale) FROM event_daily_rollups
   WHERE event_id IN (SELECT id FROM events WHERE event_code='WC26-EDINBURGH');
   ```
   Result must equal £448.58 (matches Meta MCP truth), NOT £1,345.74.

## Out of scope
- Don't touch the `ad_spend` column — that fanout is intentional (raw venue total per-event, allocated col is the source-of-truth for reporting).
- Don't touch `ad_spend_allocated` / `ad_spend_specific` / `ad_spend_generic_share` — those already work.
- Don't change the `shouldSkipVenueAllocatorBatch` dedupe — it's correct, the bug is the Meta leg writing an allocator-owned column.

## Commit message
```
fix(rollups): stop Meta leg clobbering ad_spend_presale on sibling syncs

The Meta leg wrote the full venue-total presale spend to every sibling
event row. The allocator then correctly divided by sibling count and
upserted the per-event share — but only on the FIRST sibling's
rollup-sync invocation (allocator is batch-deduped). The next sibling's
Meta leg re-wrote ad_spend_presale back to the venue total, so siblings
2..N retained 3× the truth.

ad_spend_presale is now allocator-owned. Meta leg no longer writes it.
Backfill migration zeros pre-fix rows so the next allocator run can
set them correctly.

Verified on WC26-EDINBURGH: lifetime presale was £1,345.74 (3×£448.58),
should be £448.58.
```
```
