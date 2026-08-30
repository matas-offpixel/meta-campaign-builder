# Session log — dashboard aggregation audit (2026-05-14)

## PR

- **Number:** 417
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/417
- **Branch:** `cursor/audit/dashboard-aggregation-audit-2026-05-14`

## Summary

Investigation-only Plan PR. After 8 PRs over 3 days each fixing a single
aggregation bug on a single dashboard surface, this audit maps every surface
× metric pair against its file path, data source, and aggregation method;
categorises every wrong number into one of A (sibling N-counting), B
(daily-deduped reach summed across days), C (wrong source), D (concept
mismatch), or E (other / race); and proposes a unified
`getCanonicalEventMetrics(clientId, eventCode)` helper that subsumes the
existing `venue-rollup-dedup`, `event_code_lifetime_meta_cache`, and
`splitEventCodeLpvByClickShare` helpers.

The headline: every ❌ surface (Funnel Pacing TOFU Reach, Creative Insights
tiles, Stats Grid Reach cache-miss fallback) collapses to two patterns —
Cat A and Cat B. The unified helper closes all three with one ~5-day arc
and unblocks Junction 2 / Boiler Room onboardings the same way.

## Scope / files

Audit-only — no TypeScript changes. Two new files in `docs/`:

- `docs/DASHBOARD_AGGREGATION_AUDIT_2026-05-14.md` — the main doc with all
  7 sections + cover summary table + appendices (548 lines).
- `docs/DASHBOARD_AGGREGATION_AUDIT_2026-05-14.csv` — companion
  spreadsheet of every surface × metric × reconciliation status (24 rows).

The audit references but does not modify:

- `lib/dashboard/venue-rollup-dedup.ts` (PR #413)
- `lib/db/event-code-lifetime-meta-cache.ts` (PR #415)
- `lib/dashboard/rollup-sync-runner.ts` (PR #415 lifetime leg)
- `lib/insights/meta.ts:fetchEventLifetimeMetaMetrics` (PR #415)
- `lib/reporting/funnel-pacing.ts:aggregateRollups` (the ❌ path for TOFU)
- `lib/reporting/creative-patterns-cross-event.ts:addGroup` (the ❌ path for tiles)
- `components/share/venue-stats-grid.tsx` (cache-swap logic, PR #415)
- `lib/db/client-portal-server.ts` (loaders)

## Validation

- [x] No code changes — `npm run build` / `npm test` not relevant for this PR.
- [x] `wc -l docs/DASHBOARD_AGGREGATION_AUDIT_2026-05-14.md` → 548 lines.
- [x] CSV opens cleanly (24 data rows + header).
- [x] All file:line references in the doc verified by `Grep` / `Read` against
  the current `cursor/audit/...` branch (which is fast-forwarded from `main`
  post-PR-415).
- [ ] Matas review pending — Plan PR labelled `audit:` so the merge bot
  doesn't auto-process.

## Validation of audit claims (sanity-check trail)

- **Sibling N-counting at Funnel Pacing TOFU Reach** — verified by reading
  `lib/reporting/funnel-pacing.ts:aggregateRollups` (L416-426) and
  `fetchRollups` (L343-356). The function selects `meta_reach` from
  `event_daily_rollups` and SUMs it directly with no dedup pass. There is
  no `dedupVenueRollupsByEventCode` import in this file. Confirmed.
- **Sibling N-counting at Creative Insights** — verified by reading
  `lib/reporting/creative-patterns-cross-event.ts:addGroup` (L559-577).
  The accumulator unconditionally `+=` for every snapshot's group. The
  `applyRegionFilter` (L370-382) at venue scope passes all 4 sibling
  Manchester events through. Confirmed.
- **Stats Grid Reach cache-miss fallback** — verified by reading
  `components/share/venue-stats-grid.tsx` (L131-138). The `showLifetimeReach`
  guard requires the cache row's `meta_reach > 0`; otherwise the cell
  renders the legacy `cells.reach` (sum-of-daily-after-sibling-dedup).
- **Pacing BOFU LPV correct** — verified by reading
  `lib/reporting/funnel-pacing.ts:resolveLpvByEventIds` (L463-524). The
  function calls `splitEventCodeLpvByClickShare` per event_code group.
  Confirmed.
- **Pacing Sale Outcome correct** — verified by reading
  `aggregateRollups` purchases line (L422). `tickets_sold` in
  `event_daily_rollups` is the per-event daily delta of provider lifetime
  cumulative (`currentSnapshotDailyDelta` in
  `rollup-sync-runner.ts` L879-899). Additive across days and events.
- **Daily Tracker / Trend Chart unaffected** — verified by reading
  `mergeVenueTimeline` in `components/share/venue-daily-report-block.tsx`
  (L618-746). Function does NOT carry `meta_reach` / `meta_impressions`
  into the timeline rows. Awareness chart variant only fires on
  `kind === "brand_campaign"` (`event-trend-chart.tsx` L119), which the
  venue surfaces never set. Confirmed.

## Notes

### Honesty about gaps

I cannot run live Supabase queries from this Cursor session, so the
Section 1 source-of-truth table contains `[QUERY PENDING]` placeholders
for everything except Manchester (Joe 2026-05-14) and the Plan PR #414
acceptance numbers. Section 1 ships an operator runbook (POST to the
admin backfill route + a SQL spot-check) that fills the table in ~5
minutes. The audit's classification (Section 4) and unified-fix
proposal (Section 5) do not depend on those exact numbers — they depend
only on the structural pattern, which is provable from code-reading.

### Memory anchors

The prompt asked me to read 5 memory anchors before starting. Only
`feedback_resolver_dashboard_test_gap.md` exists as a standalone file in
`docs/`; the other 4 (`feedback_collapse_strategy_per_consumer`,
`feedback_snapshot_source_completeness`, `feedback_multi_link_backfill_scope`,
`feedback_layered_fix_pattern`) are referenced by
`DASHBOARD_BUILD_AUDIT_2026-05-09.md` but never landed as standalone
docs. I read the resolver-test-gap anchor in full, absorbed the spirit of
the other four from the build-audit, and noted in §appendix that they
could be derived from existing PR session logs in ~1 hour by Cursor if
the project wants them spelled out.

### Friday demo path

Section 7 lays out the order of operations:

1. Cache pre-warm (5 min, ops-driven) — fixes Stats Grid Reach today.
2. Funnel pacing through canonical helper (~0.5 day, Cursor) — fixes Pacing TOFU.
3. Stats Grid hard-fail on cache miss (~2 hr, cc) — kills the flip-flop.

After those three, Manchester reaches reconcile to 799k ±2% across every
surface that displays a reach number. Brighton / Kentish / Shepherds
inherit the same fix because the bug pattern is identical at the code
level.

### Why two helpers, not one

The prompt's hypothesis was `getCanonicalEventMetric(eventCode, metric, scope)`.
I refined to `getCanonicalEventMetrics(clientId, eventCode) → struct` because
returning the whole metric struct in one call batches three SQL queries
(cache + rollup + tier-channel) into one server hop per venue scope, which
matches today's `loadPortalForClientId` shape. Per-call shape would 10× the
query load. Documented in §5.

### Risk that Matas should know about

If we ship 5.2 (canonical helper for funnel pacing) without 5.3 (creative
insights dedup), the Pacing tab and the Insights tab will agree on reach
in some scenarios and disagree in others — which is worse than today's
"both wrong but consistently wrong" state. Recommendation in §7: ship 5.2
and 5.4 by Friday, hold 5.3 + 5.5 to Monday so the two surfaces flip
together. Matas should sign off on which order.

### Follow-up flags

- The Glasgow venue cards will under-count reach post-PR #415 because the
  lifetime cache doesn't fold the `WC26-GLASGOW` umbrella spend into
  venue-sibling reach the way the daily helper does for spend. Documented
  in §6 Flag 5; if Joe complains, the deferred PR B from Plan PR #414
  (umbrella tile) is the natural answer.
- Surface 1 (`/share/client/[token]` — Topline Reach (sum)) does not exist
  today. If the demo wants client-wide reach (sum across all 4thefans
  venues), it can be built in ~0.5 day on top of `getCanonicalEventMetrics`
  by iterating event_codes and summing — the cache makes this safe because
  each event_code's reach is its own deduped number.
