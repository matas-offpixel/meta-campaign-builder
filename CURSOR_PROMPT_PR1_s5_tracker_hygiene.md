[Cursor, Sonnet] PR #1 — S5/H tracker hygiene: suppress manual `ticket_sales_snapshots` from daily-delta path

## Mission

Stop reconciliation-source rows in `ticket_sales_snapshots` from leaking as phantom daily sales. Per PR #536 audit (Surface 5, Bug H), the Manchester +43 spike on 2026-06-04 was our own SQL topup landing in the snapshot-envelope before the daily_history cron filled the gap. Goal: classify `source IN ('manual','xlsx_import')` rows as **cumulative anchors only** — they raise the envelope ceiling so lifetime totals stay correct, but never emit a per-day delta.

**Read these first (do not skip):**
- `docs/dashboard-truth-audit-2026-06-04.md` — Surface 5 section + Daily-tracking fix proposal
- Memory: `feedback_ticket_sales_snapshots_cumulative_not_delta`
- Memory: `feedback_audit_corrected_5_premises_pr536`
- Memory: `project_creator_daily_tracker_phantom_attribution_2026-05-21`
- Memory: `feedback_no_fallback_papering_over_broken_source`

## Verified mechanism (audit-confirmed, do NOT re-debug)

1. Topup rows from PR #530 went to `ticket_sales_snapshots` with `source='manual'` (Glasgow O2 +403, SWG3 +794, Manchester +66 net). Cumulative per fixture.
2. `tier_channel_sales_daily_history` was NOT written — manual SQL bypasses the daily-history cron.
3. The corroborated daily-delta path reads daily_history first (per-date priority via `buildEventCumulativeTicketTimeline:146-156`). Manchester Jun 4 cron landed +19 there — the truthful delta.
4. BUT the snapshot envelope reader picks up the manual snapshot whenever daily_history hasn't run for that date yet — and the lifetime tile (`resolveDisplayTicketCount`) reflects manual topups immediately as a day-over-day jump. That's the +43.

So the fix has two layers:
- Daily-delta builder must exclude reconciliation snapshots from emitting deltas
- Lifetime tile's day-over-day comparison must read the corroborated daily series, not the lifetime-tile difference

## Scope

### Layer 1 — Delta builder (the leak)

File: `lib/dashboard/venue-trend-points.ts`

Functions to modify:
- `buildEventCumulativeTicketTimeline` (around `:124-156` per audit)
- `corroboratedDailyDeltas` / `buildCorroboratedDailyDeltas` (around `:586-617`)

Behavior change:
- When iterating `ticket_sales_snapshots` rows, **exclude `source IN ('manual','xlsx_import')` from per-day delta emission**.
- Manual rows STILL participate in:
  - The envelope ceiling (lifetime total stays accurate)
  - The cumulative-anchor logic (so they re-base the series correctly)
- Manual rows DO NOT contribute to:
  - `tickets_today` delta on the corresponding date
  - Any per-day series consumed by the daily tracker UI

The existing `MANUAL_SOURCE_KINDS` constant at `:519` is for `tier_channel_sales_daily_history.source_kind` (bypass case — `manual_backfill` SHOULD emit). This new rule is for the sibling `ticket_sales_snapshots.source` field. Use a separate constant — DO NOT reuse `MANUAL_SOURCE_KINDS` to suppress on the daily_history side. Per `feedback_collapse_strategy_per_consumer`, the two collapse strategies serve different consumers.

Suggested name: `RECONCILIATION_SNAPSHOT_SOURCES = ['manual', 'xlsx_import'] as const`.

### Layer 2 — Lifetime-tile day-over-day stabilisation

File: depends on where the tile widget lives — grep for `resolveDisplayTicketCount` and look for the day-over-day delta computation that surfaced as "+43" on Manchester. Likely in `components/share/venue-stats-grid.tsx` or `client-portal-venue-table.tsx`.

Behavior change:
- The "today vs yesterday" delta widget should read from the corroborated daily series (Layer 1 output), NOT from `resolveDisplayTicketCount(today) - resolveDisplayTicketCount(yesterday)`.
- This keeps the lifetime tile total accurate (still shows 1,001 for Manchester) but the day-over-day display reads the cron-truthful +19.

If the widget is currently doing `lifetime(today) - lifetime(yesterday)`, switch it to consume the same `corroboratedDailyDeltas` output the tracker uses.

### Layer 3 — Tests

File: `lib/dashboard/__tests__/corroborated-daily-deltas.test.ts` (or create if missing).

Add a fixture:
- 5 days of `ticket_sales_snapshots` rows for a single fixture
- Day 3 is `source='manual'` with cumulative jump +100
- Day 4 is `source='eventbrite'` with +15 organic
- Assert:
  - Day 3 delta from the builder = **0** (manual suppressed)
  - Day 4 delta = +15 (real organic preserved)
  - Lifetime total at end = baseline + 115 (manual still raised envelope)
  - Series gap-fill behavior on day 3 (carry-forward) doesn't re-emit the jump

Also add a Manchester-shape regression test:
- Daily_history has Jun 4 = +19
- ticket_sales_snapshots has Jun 4 manual = cumulative 1,001 (delta +43 if naïve)
- Assert delta builder returns **+19 (daily_history truth)**, not +43.

## Anti-drift guardrails

- **DO NOT touch `lib/dashboard/venue-spend-allocator.ts`.** That's the Surface 6 PR (presale over-attribution, allocator-owner gated).
- **DO NOT add `source='manual'` rows to `ticket_sales_snapshots` as a side-fix** — that's what created the leak. Per memory `feedback_no_fallback_papering_over_broken_source`.
- **DO NOT modify `tier_channel_sales_daily_history`** behavior on the cron side. The cron is the source of truth for per-day; this PR fixes the consumer-side leak only.
- **DO NOT widen `RECONCILIATION_SNAPSHOT_SOURCES` beyond `manual` and `xlsx_import`.** `eventbrite`, `fourthefans`, `foursomething` are real-time sources and MUST continue to emit deltas. Per `feedback_collapse_strategy_per_consumer`.
- **Verify Manchester behavior in prod after deploy** — query `event_daily_rollups` + corroboratedDailyDeltas for Manchester Jun 4 and confirm the tracker now shows +19 not +43.

## Verification gate

Before merging:
1. Add the test from Layer 3 — it should pass.
2. Test screenshot/recording: load Manchester venue report after deploy. Daily-tracker Jun 4 row should show +19 (or whatever the cron has recorded), NOT +43.
3. Glasgow SWG3 (which had +794 manual topup) should show **no Jun 4 daily-sales delta** in the tracker — it's all reconciliation, no organic sales.
4. Lifetime totals stay at 1,001 (Manchester) and 3,389 (SWG3) — envelope correct.
5. Bristol/Aberdeen (no recent manual topups) should be unchanged.

## Branch / model

- Branch: `cursor/dashboard-fix-s5-daily-tracker-suppress-manual-deltas`
- Model: Sonnet
- Single PR
- Bundles with PR #3 (S8 disclosure) IF cleanly separable — otherwise leave S8 for next PR

## Cross-references

- PR #536 (the audit — read Surface 5 section first)
- PR #530 (the topup that exposed the bug)
- PR #438 (corroboration architecture)
- PR #378 (daily-history cron)
- Memory: `feedback_collapse_strategy_per_consumer`, `feedback_ticket_sales_snapshots_cumulative_not_delta`
