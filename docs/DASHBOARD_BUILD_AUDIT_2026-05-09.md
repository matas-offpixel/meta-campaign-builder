# 4thefans Dashboard — Build Audit & Reusability Memo

**Date:** 2026-05-09
**Scope:** what to keep, what to fix, and the order in which to act, before Junction 2 / Louder / Boiler Room dashboard onboardings.

---

## Executive Summary

The 4thefans dashboard data layer is **deployable for new clients today**. The 5 recommended improvements below are about making it **fast and safe** to deploy, not making it possible. After 18 PRs across two days reconciling Manchester WC26 and the venue report restructure, the patterns are battle-tested but the build still has hard-coded shortcuts that won't survive the next client without refactoring.

---

## Strong Architecture Patterns (Keep + Replicate)

### Data flow chain

The four-layer chain is the right shape:

```
ticket_sales_snapshots  →  tier_channel_sales  →  tier_channel_sales_daily_history  →  event_daily_rollups
   (per-source raw)        (per-channel current)      (per-day cumulative truth)         (display)
```

Every regression in the recent rebuild was at the **boundary between layers**, not within them. The pieces work; the seams need test coverage.

### Reusable patterns to copy verbatim

1. **Provider registry indirection** — `lib/ticketing/registry.ts`. Adding Junction 2's ticketing system is a one-line edit.
2. **Three-caller runner extraction** — `runRollupSyncForEvent` runs from owner-session, share-token, and cron with the same routine.
3. **Channel-ownership contract** — `lib/ticketing/CONTRACT.md` plus regression test. Sync writes only the provider's automatic channel.
4. **Math.max resolver pattern** — `resolveDisplayTicketCount(tier_tiers, snapshot, fallback, channel_sales_sum)`. Adding sources = adding args.
5. **Build-version cache invalidation** — `VERCEL_GIT_COMMIT_SHA` stamped to snapshot rows. Used in 5 places.
6. **Smoothing algorithm** — `lib/dashboard/tier-channel-smoothing.ts`. Pure module, no client-specific assumptions. Junction 2 reuses unchanged.
7. **Service-role + owner_id pattern** — sync writers use service-role client but stamp resolved owner's user_id, preserving per-user RLS.
8. **Internal vs share parity by file-sharing, not config** — same `<DashboardTabs>` tree with `isShared` flag.

---

## Anti-Patterns (Fix Before Next Client)

### 1. Allocator hard-codes WC26

`isWc26OpponentAllocatorEventCode` keys on the literal `WC26-` prefix. 9 references across allocator paths plus dedicated `wc26-glasgow-umbrella.ts` and `wc26-london-split.ts` modules. Junction 2 (5 events at one venue, no opponents) works via equal-split. Boiler Room (multi-region brand campaign) won't fit any current strategy.

**Single biggest blocker for next client.**

### 2. Two-writer paths to `tier_channel_sales`

Enforced socially via `CONTRACT.md`, not at DB level. Sync writes provider-owned channel; operator UI writes Venue/manual; admin backfills write whatever. CHECK constraint or per-channel policy is the right fix.

### 3. Migration ordering broken

068 has 3 colliding files, 069 has 2, gaps at 021/043/047. Fresh-env restore could re-apply in wrong order. `supabase/schema.sql` is also stale — generated types in `lib/db/database.types.ts` are the actual truth.

### 4. 18 writer endpoints

5 admin backfill routes (`event-history`, `event-rollup`, `fourthefans-rollup`, `fourthefans-tier`, `eventbrite-tier`) doing variations of the same thing. Should be one `POST /api/admin/backfill?kind=...` with shared auth, idempotency, and run-log table.

### 5. Zero DOM-level component tests

150 `.test.ts` files, 0 `.test.tsx`. The PR #368 regression (resolver passed, dashboard rendered wrong) still has no test infrastructure to catch the same class of bug.

### 6. `client-portal-venue-table.tsx` is 2,710 lines

Imports 11 helpers, hosts edit modals, sync buttons, expanded state. Future client whose layout differs will copy the whole file. Needs `columns: ColumnDef[]` prop pattern.

### 7. `loadClientPortalByClientId` is 1,584 lines

Loader pattern is correct (centralized, not scattered through components) but the file size says it's doing too much in one function. Untested.

### 8. Cron silent-success threshold

`cron/rollup-sync-events/route.ts` totals `rowsUpserted` per event but response is `ok=true` even when every event returns 0 rows. Class of bug that ate PR #261 / #259 in April.

---

## Onboarding A New Client — Today's Manual Sequence

10 manual steps + 2 curl calls, ~30 minutes per client:

1. Create client row via `/clients/new`
2. Connect Meta OAuth
3. Manually set `clients.meta_ad_account_id`
4. Create ticketing connection + paste token
5. Discover links via `/ticketing-link-discovery`
6. Auto-match OR xlsx-import via `/ticketing-import`
7. First sync (button or wait for cron)
8. Mint share token via `share-dashboard-button`
9. `POST /api/admin/event-history-backfill` per event
10. `POST /api/admin/smooth-historical-tier-channel-sales` per event

No wizard, no checklist, no rollback if something fails mid-flow.

---

## Top 5 Priority Improvements

### #1 Allocator strategy registry — 1 day Cursor

Replace `isWc26OpponentAllocatorEventCode` with `getAllocatorStrategy(client, event)`. Enum: `'opponent_match' | 'equal_split' | 'solo' | 'london_split' | 'glasgow_umbrella'`. Eliminates 9 hard-coded references and unblocks Junction 2 + Boiler Room without touching `venue-spend-allocator.ts`.

### #2 Onboarding wizard — 2 days Cursor

5-screen Next.js form: Meta connect → ticketing connect → link auto-match → first-sync confirm → share-token mint. Cuts onboard time from 30min to 5min. Direct hit on the time-compression north star.

### #3 DOM smoke tests — half day

`client-portal-venue-table` + `venue-full-report` with 5 representative scenarios (single-venue, multi-venue, presale-only, sold-out, no-data). Closes the PR #368 gap permanently.

### #4 Admin backfill consolidation — 1 day Cursor

5 routes → 1 parameterised endpoint with shared auth, idempotency keys, `backfill_runs` audit table. Removes silent-success class of bug across all of them.

### #5 Migration cleanup + schema regen — half day

Rename 068/069 collisions to 088a/088b/088c style. Document 021/043/047 gaps. Regenerate `supabase/schema.sql` from current state. Preventive — fresh-env restore could break at the worst moment.

---

## Recommended Sequence

| Week | Items | Risk | Outcome |
|---|---|---|---|
| 1 | #5 migration cleanup, #3 DOM smoke tests | Low | Foundation + regression protection |
| 2 | #1 allocator registry, #4 backfill consolidation | Medium | Junction 2-ready, silent-failure class killed |
| 3 | #2 onboarding wizard | High value | First wizard-driven new-client launch |

After all 5: every new client onboarding is wizard-driven, allocator routes via strategy lookup, regression-protected by DOM tests, backfill is one endpoint with audit log. Onboarding time drops 30min → 5min. The failure modes that cost 18 PRs in two days stop being possible.

---

## What's Reusable As-Is

Even today, you can launch Junction 2 by:
- Reusing the entire ticketing connector path (Eventbrite or build a See Tickets provider)
- Reusing `runRollupSyncForEvent` runner unchanged
- Reusing the resolver, smoothing, daily history pattern unchanged
- Reusing the share token surface unchanged
- Following the 10-step manual onboarding sequence

Dashboard data layer is **deployable for new clients today**. The 5 improvements are about making it fast and safe, not making it possible.

---

## Lessons Captured (Memory Anchors)

- `feedback_resolver_dashboard_test_gap.md` — resolver-level unit tests don't prove dashboard renders correctly
- `feedback_collapse_strategy_per_consumer.md` — one collapse strategy can't serve two consumers (WoW vs trend)
- `feedback_snapshot_source_completeness.md` — snapshot source must represent same scope as display target
- `feedback_defensive_json_parse_pattern.md` — Vercel timeout pages return HTML at status 200/504
- `feedback_scan_history_dedup_pattern.md` — append-only scan caches need read-time DISTINCT ON

These are the patterns. Future client builds should pattern-match against them before writing new code.

---

## Total Arc Tally (2026-05-08 — 2026-05-09)

- 18 PRs squash-merged
- 1 direct commit (ab978b5 — procedural slip, accepted as-is)
- 1 migration applied (089 — tier_channel_sales_daily_history)
- 4 new memory anchors written
- 1 audit doc (this file)
