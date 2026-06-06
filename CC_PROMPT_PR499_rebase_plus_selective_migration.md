[Claude Code, Opus] PR #499 Stage B — Rebase + selective migration + wider-window backfill route

## Mission

Land the presale-clobber fix that already exists on `cc/presale-clobber-fix` (PR #499), but with two blockers resolved per Cursor's Stage A audit (PR #543):

1. **Migration 102 → 109** (main is now at 108).
2. **Migration's `UPDATE` is too broad** — zeroes all multi-fixture presale including Brighton's correct even-split. Brighton's presale window is Jan-Apr 2026, outside the live cron's 60-day cap → without a wider backfill, Brighton regresses from +£119 over → -£1,585 under after deploy.

**Read these first (do not skip):**
- `docs/dashboard-presale-overattribution-mechanism-2026-06-XX.md` (PR #543 Stage A audit)
- Memory: `feedback_premise_inverted_again_pr543` — why the original "two allocator branches" theory was wrong
- Memory: `feedback_audit_corrected_5_premises_pr536`
- Memory: `feedback_no_fallback_papering_over_broken_source`
- Memory: `feedback_pr_shipping_prerequisite_checklist` — migration + admin route + middleware checklist
- Memory: `feedback_supabase_migration_verification` — verify post-merge that migration ran

## What the existing PR #499 already gets right

- `rollup-sync-runner.ts:724` — wraps `ad_spend_presale` in `ownedOrNull()` ✓
- Joins engagement-owner column group (same pattern as `link_clicks`, `landing_page_views`, `meta_regs`) ✓
- `upsertMetaRollups` non-owner-null behavior preserved ✓
- 6/6 venue-spend-allocator tests pass ✓
- Solo / non-WC26 paths preserved ✓

## What PR #499 needs to add (this PR's scope)

### Fix 1: Renumber migration

`supabase/migrations/102_presale_zero_multi_fixture_clobbered.sql` → `109_presale_zero_multi_fixture_clobbered.sql` (or whatever next number is — verify main HEAD).

Update `supabase/schema.sql` if the migration is referenced there.

### Fix 2: Make the migration SELECTIVE — only zero non-owner rows

Current migration (per Cursor's audit) zeroes ALL multi-fixture presale indiscriminately. That regresses Brighton (correctly even-split) and any other venue whose siblings already carry the right per-fixture share.

New shape:

```sql
-- 109_presale_zero_multi_fixture_clobbered.sql

BEGIN;

-- Identify multi-fixture event_codes (have ≥2 events sharing client_id + event_code)
-- Only zero ad_spend_presale on NON-engagement-owner siblings.
-- The engagement owner = the row that has any non-null engagement column
-- (link_clicks, meta_reach, etc.) — that's the row the allocator reads from
-- and that's the row that should keep the venue presale total (which the
-- post-fix allocator will then divide on its next batch run).

UPDATE event_daily_rollups r
SET ad_spend_presale = NULL
WHERE r.ad_spend_presale IS NOT NULL
  AND r.ad_spend_presale > 0
  AND r.event_id IN (
    SELECT e.id
    FROM events e
    WHERE e.event_code IN (
      SELECT event_code FROM events
      WHERE client_id IS NOT NULL
      GROUP BY client_id, event_code
      HAVING COUNT(*) > 1
    )
  )
  -- Only non-owner rows (no engagement signal)
  AND r.link_clicks IS NULL
  AND r.meta_reach IS NULL
  AND r.meta_regs IS NULL;

-- Owner rows keep their value. Allocator's next run will read the owner's
-- preserved venue total and divide it per fixture, writing the correct
-- per-fixture share to siblings (which the post-fix rollup-sync no longer
-- clobbers).

COMMIT;
```

**Critical check before merging this migration:** verify the SELECT count BEFORE running the UPDATE. Should be the 7 broken venues' sibling rows only (Birmingham, Bournemouth, Bristol, Leeds, Newcastle, Edinburgh, Glasgow SWG3) + their non-owner siblings × their presale days. Estimated row count: ~7 venues × ~3 siblings × ~6-17 presale days = ~150-350 rows. **NOT** Brighton's 4 × ~10 days = 40 rows; those are correct and must not be touched.

If the selective WHERE doesn't reproduce Brighton's correctness (i.e. Brighton has engagement on ALL 4 siblings — possible because the live cron may have written engagement to non-owner rows historically), then add a more precise condition:

```sql
  -- Only zero where the presale value equals the venue total
  -- AND there's another sibling with the same value (= replicate pattern)
  AND r.ad_spend_presale = (
    SELECT MAX(r2.ad_spend_presale)
    FROM event_daily_rollups r2
    JOIN events e2 ON e2.id = r2.event_id
    JOIN events e_self ON e_self.id = r.event_id
    WHERE e2.event_code = e_self.event_code
      AND e2.client_id = e_self.client_id
      AND r2.date = r.date
  )
```

Test in a Supabase branch BEFORE applying to prod.

### Fix 3: Add wider-window backfill admin route

File: `app/api/admin/event-presale-backfill/route.ts`

Mirrors `event-rollup-backfill` pattern but with `windowDays = 365` (or `since: campaign earliest start_time`) instead of `60`. Calls `runRollupSyncForEvent` for each multi-fixture WC26 event — which now writes engagement-owner-only presale (post-fix code) and triggers the allocator to redistribute correctly.

Why wider window: presale campaigns ran Jan-Apr 2026 (>60 days ago). The 60-day cron (`MAX_ALLOCATOR_BACKFILL_DAYS` per PR #481) can't reach them. This admin route is a one-shot.

Pattern to follow: existing `app/api/admin/event-rollup-backfill/route.ts:55-211` (the `fourthefansForceBackfill` function uses `windowDays = 90`; widen to 365 here).

### Fix 4: PUBLIC_PREFIXES carve-out

Add `/api/admin/event-presale-backfill` to `lib/auth/public-routes.ts` PUBLIC_PREFIXES so the `Bearer $CRON_SECRET` flow works. Per memory `feedback_middleware_swallows_bearer_auth`.

### Fix 5: Session log

`docs/session-logs/pr-499-presale-clobber-fix-rebased.md` documenting the Stage A finding, the rebase, and the post-merge runbook.

## Runbook for post-merge

1. Merge PR #499 (rebased, with fixes 1-4).
2. Verify migration 109 ran in Supabase (check `supabase_migrations.schema_migrations`).
3. Run the wider-window backfill admin route:
   ```bash
   curl -X POST https://app.offpixel.co.uk/api/admin/event-presale-backfill \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"client_id":"37906506-56b7-4d58-ab62-1b042e2b561a"}'
   ```
4. Verification SQL (paste output in PR description, every row must show `ABS(drift) ≤ 150`):

   ```sql
   WITH meta_truth AS (
     SELECT * FROM (VALUES
       ('WC26-ABERDEEN', 3257),  ('WC26-BIRMINGHAM', 4159), ('WC26-BOURNEMOUTH', 3987),
       ('WC26-BRIGHTON', 8836),  ('WC26-BRISTOL', 3817),   ('WC26-EDINBURGH', 7801),
       ('WC26-GLASGOW-O2', 6478),('WC26-GLASGOW-SWG3', 2854), ('WC26-LEEDS', 3776),
       ('WC26-LONDON-KENTISH', 4565), ('WC26-LONDON-SHEPHERDS', 2080),
       ('WC26-LONDON-SHOREDITCH', 2954),  ('WC26-LONDON-TOTTENHAM', 1847),
       ('WC26-MANCHESTER', 10423), ('WC26-MARGATE', 1968), ('WC26-NEWCASTLE', 3951)
     ) AS t(event_code, truth)
   )
   SELECT e.event_code,
          ROUND(SUM(r.ad_spend_allocated)::numeric, 2) AS allocated,
          ROUND(SUM(r.ad_spend_presale)::numeric, 2) AS presale,
          ROUND((COALESCE(SUM(r.ad_spend_allocated),0)+COALESCE(SUM(r.ad_spend_presale),0))::numeric, 2) AS effective,
          mt.truth,
          ROUND(((COALESCE(SUM(r.ad_spend_allocated),0)+COALESCE(SUM(r.ad_spend_presale),0)) - mt.truth)::numeric, 2) AS drift
   FROM events e
   LEFT JOIN event_daily_rollups r ON r.event_id = e.id
   LEFT JOIN meta_truth mt ON mt.event_code = e.event_code
   WHERE e.client_id = '37906506-56b7-4d58-ab62-1b042e2b561a' AND e.event_code LIKE 'WC26-%'
     AND mt.truth IS NOT NULL
   GROUP BY e.event_code, mt.truth
   ORDER BY ABS((COALESCE(SUM(r.ad_spend_allocated),0)+COALESCE(SUM(r.ad_spend_presale),0)) - mt.truth) DESC;
   ```
5. Brighton check: Brighton presale SUM must remain ~£1,704 (its truth). If Brighton lands at £0, the migration was too broad — emergency rollback path = re-run backfill with cron secret OR `INSERT` Brighton's per-fixture presale back via SQL.

## Anti-drift guardrails

- **DO NOT modify `lib/dashboard/venue-spend-allocator.ts`** — it's correct (line 835 already divides). Cursor's audit verified.
- **DO NOT touch `lib/dashboard/venue-trend-points.ts`** — PR #539, merged.
- **DO NOT touch `components/share/client-portal.tsx:200`** — PR #542, merged.
- **DO NOT widen the live cron's 60-day window** — that's load-bearing per PR #481 / PR #479. This PR adds a one-shot route, not a cron change.
- **DO NOT introduce CAMPAIGN_SPLITS overrides** — wrong tool. PR #530 was for ad-set-name mismatch only.
- **VERIFY the selective migration on a Supabase branch first** — running it directly on prod risks Brighton regression. Per `feedback_supabase_migration_verification`.
- **MUST cite SELECT-COUNT pre-flight** in PR description — how many rows the UPDATE will touch, broken down by event_code.

## Tool ownership

- PR #499 lives on `cc/presale-clobber-fix` → **Claude Code edits only**, per CLAUDE.md tool-ownership convention.
- This PR is Stage B follow-up of PR #543 (Cursor's Stage A audit).
- Branch: `cc/presale-clobber-fix` (rebase + add fixes 1-5). One PR, one ship.

## Cross-references

- PR #536 (parent audit)
- PR #543 (Stage A — Cursor's diagnosis that overturned my premise)
- PR #499 (existing fix, unmerged)
- PR #481 (60-day allocator cap, load-bearing)
- PR #483 (allocator dedupe per client_id+event_code — explains why batch dedup + per-sibling sync = clobber)
- PR #494 (legacy paused-spend backfill — partial sibling pattern)
- PR #539 (S5/H tracker hygiene — sibling fix-the-source discipline)
- PR #542 (S1/D Topline £878 — sibling presale fix at a different layer)
