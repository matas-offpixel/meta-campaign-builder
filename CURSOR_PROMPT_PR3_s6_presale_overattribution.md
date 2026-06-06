[Cursor, Opus] PR #3 — S6 Presale over-attribution fix (+£10,664 portfolio drift)

## Mission

Close the +£10,664 / +14% portfolio over-attribution from PR #536 Surface 6 / Bug A. Six venues currently show `effective_paid` ~£937–£1,401 above Meta MCP truth, and the mechanism is fully traced: per-event_code `SUM(ad_spend_presale)` triple-counts the same presale total because the value is replicated across sibling fixture rows, not even-split.

**This is the highest-£ remaining drift on the dashboard.** All four spend-reading surfaces (Topline, Venue Report, Performance Summary, Funnel Pacing) inherit the bug because they all read `SUM(allocated + presale)` per event_code via `paid-spend.ts:8-22`.

**Read these first (do not skip):**
- `docs/dashboard-truth-audit-2026-06-04.md` — Surface 6 section + the live spend table
- Memory: `feedback_audit_corrected_5_premises_pr536` — premise discipline
- Memory: `feedback_no_handwave_when_numbers_dont_match`
- Memory: `feedback_source_priority_in_collapse_strategies` — input-boundary discipline
- Memory: `project_creator_canonical_builder_convergence_scope`
- Memory: `feedback_no_fallback_papering_over_broken_source`
- Memory: `feedback_collapse_strategy_per_consumer`

## Verified mechanism (Cowork-side SQL, 2026-06-04, do NOT re-debug)

### The shape of the bug (Edinburgh example, 3 fixtures)

Per-fixture rows in `event_daily_rollups`:
| fixture event_date | SUM(ad_spend_allocated) | SUM(ad_spend_presale) |
|---|---|---|
| 2026-06-13 | £2,607.32 | **£448.58** |
| 2026-06-19 | £2,508.40 | **£448.58** |
| 2026-06-24 | £2,514.83 | **£448.58** |

`SUM(presale)` across 3 fixtures = £1,345.74. **But the Meta truth for `[WC26-EDINBURGH] PRESALE` campaign is £448.65.** The presale total is replicated per fixture, NOT even-split. When the dashboard sums per event_code, it triple-counts.

Confirmed identical pattern across 6 venues:
- Aberdeen: presale £448.65 truth → SUM = £448.65 (3 × £149.55 — correctly split here, only ~£26 over)
- Birmingham: presale £440.09 truth → SUM = £1,760.36 (4 × £440.09 — **4× over**)
- Bournemouth: presale £445.82 truth → SUM = £1,783.28 (4 × £445.82 — **4× over**)
- Bristol: presale £441.17 truth → SUM = £1,764.68 (4 × £441.17 — **4× over**)
- Leeds: presale £448.97 truth → SUM = £1,795.88 (4 × £448.97 — **4× over**)
- Newcastle: presale £460.39 truth → SUM = £1,841.56 (4 × £460.39 — **4× over**)
- Edinburgh: presale £448.58 truth → SUM = £1,345.74 (3 × £448.58 — **3× over**)
- Glasgow SWG3: presale £447.52 truth → SUM = £1,342.56 (3 × £447.52 — **3× over**)
- Brighton: presale £1,704.44 truth → SUM = £1,704.52 (correctly split — match)
- Manchester: presale ~£1,085 truth → SUM = £1,084.97 (correctly split — match)

**The bug is NOT consistent.** Brighton + Manchester (and Aberdeen, partially) have CORRECT even-split. The 6 broken venues (Birmingham, Bournemouth, Bristol, Leeds, Newcastle, Edinburgh, Glasgow SWG3) have replicated presale across siblings.

### Distinguishing the two patterns

The bug exists because there's a **write-side branch** in `lib/dashboard/venue-spend-allocator.ts` where some venues' presale gets even-split across same-venue fixtures, while others' gets replicated. The audit's Surface 6 said "the allocator file is read-only" (correct discipline) but did NOT identify which branch produces the replicate-vs-split divergence.

This PR's job: trace the allocator's two paths and either:
- **Option A**: Convert all venues to even-split write (matches Brighton/Manchester behavior). Backfill the 7 broken venues' historical rows. Read side stays unchanged.
- **Option B**: Switch the read side from `SUM(presale)` to `MAX(presale)` per event_code (correct when replicated, harmless when split — but feels fragile).
- **Option C**: Add a per-fixture-vs-per-eventcode flag to the allocator output and have the reader respect it.

Recommend **Option A** (write-side normalization) per `feedback_no_fallback_papering_over_broken_source` — fixing the source is cleaner than papering with a smart read.

## What this PR must NOT do

- DO NOT touch `lib/dashboard/venue-trend-points.ts` (PR #539 surface, merged)
- DO NOT touch `components/share/client-portal.tsx:200` (PR #542 surface, merged)
- DO NOT introduce a `CAMPAIGN_SPLITS`-style override per affected venue. That pattern is for ad-set-name mismatch (Glasgow only). The presale bug is allocator-shape, not naming-shape.
- DO NOT SQL-UPDATE rollup rows to patch the symptom. Fix the write code, then backfill via a clean rerun of the allocator on historical days.
- DO NOT touch `applyAdsetSplitsToLifetimeMeta` — engagement is correct
- DO NOT modify the Topline aggregator or Surface 1/3/4 components — they're correct given correct `event_daily_rollups`

## Required first phase — diagnose-then-implement

Per `feedback_audit_first_when_layered_fixes_emerge`, this PR splits in two stages:

### Stage A: Diagnosis doc (audit-only, no code change)

Output: `docs/dashboard-presale-overattribution-mechanism-2026-06-XX.md`

Grep `lib/dashboard/venue-spend-allocator.ts` to identify the two write paths:
1. The branch that produced Brighton/Manchester's even-split (correct)
2. The branch that produced Birmingham/Bournemouth/Bristol/Leeds/Newcastle/Edinburgh/SWG3's replicate (broken)

Cite the function name, line range, and the conditional that diverges them. The audit said this lives in `equalSplitNonWc26AllocatedSpend` or the WC26 opponent allocator's presale handling — confirm or correct.

Also document the per-day write pattern for one venue in each branch:
- Brighton (correct shape): which rows get which presale value on which dates?
- Edinburgh (broken shape): same

Once Stage A doc is reviewed by Matas → proceed to Stage B implementation.

### Stage B: Implementation

After Stage A approval. Likely shape:
- Modify the broken branch of the allocator to even-split presale (matches Brighton/Manchester)
- Add a one-shot admin route `app/api/admin/event-presale-rebalance/route.ts` that rewrites `ad_spend_presale` for the 7 affected venues' historical rows (uses the corrected even-split logic)
- Verification SQL: post-rebalance `SUM(presale)` per event_code matches Meta truth for `[WC26-X] PRESALE` campaign
- Regression test in `lib/dashboard/__tests__/venue-spend-allocator.test.ts` — given fixture data with N siblings + 1 presale campaign total £P, allocator emits £P/N per fixture per presale day, summing to £P across fixtures

## Verification gate

Before Stage B merges:
1. Live SQL after backfill (per-event_code `effective_paid` query from `feedback_audit_corrected_5_premises_pr536`) should show all 16 venues within ±£150 of Meta MCP truth.
2. Brighton + Manchester must remain unchanged (they were correct).
3. No daily-tracker delta phantoms on Glasgow SWG3 / Manchester (PR #539 guard still active).
4. Topline £878 ONSALE+PRESALE remains correct (PR #542 still active).

Live SQL after backfill (Cursor must run this and paste output in PR description):

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

Pass condition: every `ABS(drift) ≤ 150`.

## Anti-drift guardrails

- **DO NOT modify `lib/dashboard/venue-spend-allocator.ts` in Stage A.** Read-only audit.
- **DO NOT touch the live cron behavior.** PR #481's 60-day window cap is load-bearing; don't widen it.
- **DO NOT SQL-UPDATE without an admin-route wrapper.** Per `feedback_pr_shipping_prerequisite_checklist`, every backfill needs an idempotent admin route, public-routes carve-out, and verification SQL.
- **DO NOT assume the bug is per-venue.** It's per-allocator-branch — fix the branch, all affected venues fix in one rebalance.
- **Verify in prod after Stage B deploy** that all 16 venues' effective_paid is within ±£150 of Meta truth.

## Branch / model

- Branch (Stage A): `cursor/dashboard-fix-s6-presale-overattribution-audit`
- Branch (Stage B): `cursor/dashboard-fix-s6-presale-overattribution-impl` (separate PR after Stage A review)
- Model: **Opus** (allocator-owner gated, architectural)
- Coordinate with Matas BEFORE opening Stage B PR — he reads the Stage A doc first

## Cross-references

- PR #536 (audit doc, Surface 6 section)
- PR #539 (S5/H tracker hygiene, MERGED) — same fix-the-source discipline
- PR #542 (S1/D Topline £878, MERGED) — sibling presale fix at a different layer
- PR #481 (60-day allocator window cap, load-bearing)
- PR #483 (allocator dedupe per (client_id, event_code))
- PR #494 (legacy paused-spend backfill, partial)
- PR #530 (Glasgow CAMPAIGN_SPLITS refresh)
- Memory: `project_dashboard_venue_allocator_three_tier`
- Memory: `feedback_no_fallback_papering_over_broken_source` — Option A reasoning
