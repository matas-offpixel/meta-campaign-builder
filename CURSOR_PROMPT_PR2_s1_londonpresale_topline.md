[Cursor, Sonnet] PR #2 — S1/D Topline: thread `londonPresaleSpend` into `aggregateAllBuckets`

## Mission

Recover £878.26 of London-Presale spend that is currently dropped from the client-portal Topline. Per PR #536 audit (Surface 1 + Bug D), `londonOnsaleSpend` is already threaded through `aggregateAllBuckets` via the `extraAdSpend` parameter — but `londonPresaleSpend` is loaded, propagated to the venue table, and then never reaches the Topline aggregator. Symptom: client-portal Topline understates portfolio spend by £878.

This is a **pure plumbing fix** — no aggregation logic, no new helpers, no new columns. The prop is already on the page.

**Read these first (do not skip):**
- `docs/dashboard-truth-audit-2026-06-04.md` — Surface 1 section + the "PRESALE £878.26: DROPPED" finding
- Memory: `feedback_audit_corrected_5_premises_pr536` — premise discipline (verify before drafting)
- Memory: `project_creator_canonical_builder_convergence_scope`

## Verified state on `main` HEAD (Cowork-side SQL + grep, 2026-06-04)

### DB state
```sql
-- Confirmed via Supabase MCP:
event_code            meta_spend_cached  allocated  presale  effective
WC26-LONDON-ONSALE    1729.60           1006.49    0.00     1006.49
WC26-LONDON-PRESALE   878.26            0.00       878.26   878.26
```

Both umbrella events have `meta_spend_cached` set. The PRESALE event also has `ad_spend_presale=£878.26` written to `event_daily_rollups`, but it's **not** in the `eventRows` list that the aggregator iterates (per `lib/db/client-portal-server.ts:719-726` the PRESALE/ONSALE synthetic rows are split out and surfaced only via top-level `londonOnsaleSpend` / `londonPresaleSpend` payload fields).

### Code state
1. `lib/db/client-portal-server.ts:723` — `londonPresaleSpend = row.meta_spend_cached ?? null` ✓ loaded
2. `lib/db/client-portal-server.ts:1078` — returned in the payload ✓
3. `components/share/client-portal.tsx:42,110,428` — declared, destructured, forwarded to `<ClientPortalVenueTable londonPresaleSpend={...} />` ✓
4. `components/share/client-portal.tsx:200` — **`aggregateAllBuckets(events, dailyRollups, additionalSpend, londonOnsaleSpend ?? 0)`** — ONLY ONSALE is passed. PRESALE is dropped here.
5. `lib/db/client-dashboard-aggregations.ts:486-491` — `aggregateAllBuckets(... extraAdSpend = 0)` — scalar, applied only to the `active` bucket via `aggregateClientWideTotals(... extraAdSpend ...)` (line 494).

## The fix (one-line change in plumbing)

File: `components/share/client-portal.tsx`

At line 200, change:
```typescript
aggregateAllBuckets(
  events,
  dailyRollups,
  additionalSpend,
  londonOnsaleSpend ?? 0,
)
```

To:
```typescript
aggregateAllBuckets(
  events,
  dailyRollups,
  additionalSpend,
  (londonOnsaleSpend ?? 0) + (londonPresaleSpend ?? 0),
)
```

Also update the `useMemo` deps array at line 202:
```typescript
[events, dailyRollups, additionalSpend, londonOnsaleSpend, londonPresaleSpend]
```

That's it for the topline. ONE component change, ONE deps update.

## Anti-drift guardrails

- **DO NOT** modify `aggregateAllBuckets` signature. Keep it as a single `extraAdSpend` scalar.
- **DO NOT** introduce a separate `londonPresaleSpend` parameter to `aggregateAllBuckets` — the audit explicitly recommends summing at the call site (low-risk patch shape, per Surface 1 fix shape).
- **DO NOT** touch `lib/db/client-dashboard-aggregations.ts` — the aggregator is correct; only the call site is missing a value.
- **DO NOT** modify the synthetic event split logic at `client-portal-server.ts:719-726`. The split is intentional (per the comment at `:713-716`, otherwise PRESALE/ONSALE would render as a phantom "London, London" venue group with one or two zero-ticket events).
- **DO NOT** touch `lib/dashboard/venue-spend-allocator.ts` — that's the Surface 6 PR (allocator-owner gated, presale over-attribution, +£10.6k portfolio).
- **DO NOT** touch `lib/dashboard/venue-trend-points.ts` — that was the PR #539 surface (Bug H), already merged.

## Verification gate before merge

1. **Live SQL re-check** (`prior_latest`-style, per `feedback_audit_corrected_5_premises_pr536`):
   ```sql
   SELECT event_code, meta_spend_cached
   FROM events
   WHERE event_code IN ('WC26-LONDON-PRESALE','WC26-LONDON-ONSALE')
     AND client_id = '37906506-56b7-4d58-ab62-1b042e2b561a';
   ```
   Confirm PRESALE still = £878.26 (snapshot value Cursor sees may have moved slightly; use whatever current value is).

2. **Unit test:** add a `client-portal` snapshot test (or expand existing `aggregateAllBuckets` tests) asserting that `clientWideTotals.adSpend` increases by `londonPresaleSpend ?? 0` when the payload sets that field. Test file: `components/share/__tests__/client-portal.test.ts` if it exists, otherwise `lib/db/__tests__/client-dashboard-aggregations.test.ts` (verify location with `find`).

3. **Visual check after deploy:** load 4thefans client dashboard. The "Ad spend" KPI on the active topline should rise by ~£878 (subject to allocator drift from Surface 6 still being open — that's expected, deferred to PR #103).

4. **Don't regress ONSALE:** the existing `londonOnsaleSpend ?? 0` behavior must remain identical. Test the sum case AND the nullable cases (`null+null`, `1729.60+null`, `null+878.26`, `1729.60+878.26`).

## Branch / model

- Branch: `cursor/dashboard-fix-s1-presale-umbrella-topline`
- Model: Sonnet (mechanical plumbing)
- Single PR
- Cleanly separable from PR #3 (S8 disclosure) — DO NOT bundle

## Cross-references

- PR #536 (the audit — Surface 1 section)
- PR #539 (S5/H tracker hygiene, MERGED) — sets the pattern for "small focused PR per surface"
- Memory: `feedback_audit_corrected_5_premises_pr536` — verify-premises discipline this prompt was drafted under (London-Presale £0 was inverted; £878 IS in DB)
- Memory: `feedback_source_priority_in_collapse_strategies` — same input-boundary discipline (this fix lives at the aggregator's input, not inside the aggregator)
- Memory: `feedback_branch_hygiene` — one PR per surface, no follow-up commits to merged branches
