# Plan PR — venue reach reconciliation + London umbrella architecture

**Author:** Cursor (Opus)
**Date:** 2026-05-13
**Branch:** `cursor/creator/london-umbrella-architecture-plan`
**Status:** Awaiting Matas greenlight before implementation
**Implementation budget (post-greenlight):** Bug #1 ≈ 1 PR, Bug #2 ≈ 1 PR, both small-medium.

## TL;DR

Two bugs were filed against the 4thefans WC26 dashboard after PR #413
(`fix(venue-stats): dedup campaign-wide Meta columns across sibling events
sharing one event_code`, merged 2026-05-13). After tracing every surface
that touches venue-level Meta metrics, we believe:

- **Bug #1 (Manchester reach 1,740,469 vs Meta UI 781,346) is NOT residual
  N-counting.** PR #413's `(event_code, date)` MAX-collapse is wired into
  every venue-level reach surface and the math reconciles cleanly to a
  single-sibling daily-reach × ~40-day window. The 2.23× discrepancy with
  Meta UI is the inherent sum-of-daily-reach vs lifetime-deduplicated-reach
  gap — a definitional mismatch, not an aggregation bug. **Fix shape:**
  add a lifetime-reach Meta API call cached per `event_code` and surface
  THAT as the venue card's "Reach" cell; rename or retire the current
  "Reach (sum)" cell.
- **Bug #2 (umbrella campaigns "bleeding" into Kentish / Tottenham /
  Shoreditch venue cards) is misdiagnosed.** The umbrella synthetic event
  rows (`event_code = WC26-LONDON-PRESALE` / `WC26-LONDON-ONSALE`) live
  outside every per-venue page's filter, so umbrella reach / impressions
  / clicks DO NOT propagate into venue cards today. Only spend is
  cross-allocated by `wc26-london-split.ts`, exactly as Joe specified.
  **Fix shape:** ZERO architectural change for reach/impressions/clicks
  attribution; OPTIONAL polish to render an explicit "London-wide series
  campaigns" panel on each London venue page so the umbrella metrics are
  legible to the client (without being summed into the per-venue card).

This plan documents the trace, the diagnosis, the proposed fixes for both
bugs, the acceptance criteria, and the open questions for Matas.

---

## 1. The trace — every venue-level Meta-metric surface, today

The 4thefans venue full report (`/share/venue/[token]` and
`/clients/[id]/venues/[event_code]`) renders six sections via
`<VenueFullReport>`. Of those, only ONE renders Meta reach:

| # | Section | Component | Reads Meta reach? | Dedup status (post PR #413) |
|---|---|---|---|---|
| 1 | Performance Summary cards | `<PerformanceSummaryCards>` | NO — only spend / tickets / capacity | n/a |
| 2 | Additional entries (collapsible) | `<CollapsibleAdditionalEntries>` | NO | n/a |
| 3 | **Topline Stats Grid** | `<VenueStatsGrid>` | **YES** — Reach (sum) cell | **Deduped** via `aggregateStatsForPlatform(rows, platform, windowSet, eventIdToCode)` (PR #413). |
| 4 | Daily trend chart | `<VenueTrendChartSection>` | NO — chart line is spend / clicks / tickets / revenue. | Trend timeline IS deduped via `mergeVenueTimeline(dedupedDailyRollups, ...)` for `link_clicks` / `meta_regs`, but reach never enters the timeline. |
| 5 | Daily tracker | `<VenueDailyTrackerSection>` | NO — same timeline as the chart | Same as (4). |
| 6 | Event Breakdown | `<VenueEventBreakdown>` | NO — Spend column only. | n/a |
| 7 | Active Creatives | `<VenueActiveCreatives>` | per-creative reach, not venue-summed | n/a (creative_insights table holds per-creative reach; never aggregated to venue total). |

**Conclusion: reach is shown on exactly one venue-level cell, and PR #413's
dedup pipeline reaches it.** No "missing wire-up" surface to fix.

### 1.1 The reach math — why "sum vs Meta UI" is NOT N-counting

Joe's production-Supabase fact (verified):

> All 4 Manchester sibling events store `meta_reach=43,840` and
> `meta_impressions=50,186` for `2026-05-12`.

Aggregation behaviour observed by Joe:

> Manchester venue card: reach **1,740,469**, impressions **1,972,012**,
> spend **£5,703**.
> Manchester Meta UI for [WC26-MANCHESTER] *: reach **781,346**,
> impressions **1,972,797**, spend **£5,703**.

Reconciling impressions (which IS perfectly sum-additive):

```
Sum-after-dedup     = N_days × daily_impressions_per_event
1,972,012           = N_days × 50,186
                    => N_days ≈ 39.3
Meta UI lifetime    = 1,972,797 ≈ N_days × 50,186 ✓
```

So PR #413 dedup is working — without it the venue card would show
4 × 39.3 × 50,186 ≈ 7,889,236 impressions (4× inflation). Spend
matches Meta UI exactly (£5,703), confirming the allocator pipeline.

Reconciling reach with the same N_days = 39.3:

```
Sum-after-dedup     = 39.3 × 43,840 ≈ 1,722,912 ≈ 1,740,469 ✓
Meta UI lifetime    = 781,346
Ratio sum/lifetime  ≈ 2.23  (each unique user reached on ~2.23 days)
```

The 2.23× gap is the inherent overlap factor. **Reach is not additive
across days** — Meta's Ads Manager UI shows campaign-window deduplicated
unique users, while our `event_daily_rollups.meta_reach` is the per-day
deduplicated reach (Meta returns one number per `(campaign, day)` pair via
`time_increment=1`, deduplicated within that day only). Summing daily
reach across days double-counts users reached on multiple days.

The cell is currently labeled `"Reach (sum)"` with a tooltip:

> "Reach (sum) is summed across campaigns — not deduplicated unique
> reach across the venue. A user reached by more than one campaign is
> counted once per campaign."

That copy is mathematically correct, but Joe's brief and Joe's clients
read the cell as Meta UI's lifetime reach. We accept the gap is a real UX
bug — the cell promises a number that DOES NOT match what Meta Ads
Manager shows for the same campaigns. Fix in §3 below.

### 1.2 The London umbrella trace — `wc26-london-split.ts`

The existing allocator (`lib/dashboard/wc26-london-split.ts`) takes the
two umbrella campaigns:

- `WC26-LONDON-PRESALE` (one synthetic event row, ~£878 lifetime spend)
- `WC26-LONDON-ONSALE` (one synthetic event row, ~£1,684 lifetime spend)

…and writes `ad_spend_allocated`, `ad_spend_specific`, `ad_spend_presale`
rows to the 12 target events (3 venues × 4 fixtures: Tottenham,
Shoreditch, Kentish — Shepherd's Bush is intentionally excluded because
it has its own `[WC26-LONDON-SHEPHERDS]` campaigns). The split is even
thirds per venue, then equal among that venue's fixtures.

**The allocator only touches spend columns.** It does NOT touch
`meta_reach`, `meta_impressions`, `meta_video_plays_*`,
`meta_engagements`, `meta_regs`, or `link_clicks`.

The umbrella synthetic event rows themselves carry the campaigns'
campaign-wide reach / impressions / etc. Those rows have
`event_code = WC26-LONDON-PRESALE` (or `-ONSALE`).

The venue page loader (`loadVenuePortalByToken` →
`loadPortalForClientId(clientId)` then filter) hard-filters
`dailyRollups` by `event_code === share.event_code`:

```
const venueEvents = portal.events.filter(
  (e) => e.event_code === share.event_code,
);
const eventIdSet = new Set(venueEvents.map((e) => e.id));
const venueDailyRollups = portal.dailyRollups.filter((r) =>
  eventIdSet.has(r.event_id),
);
```

So Kentish Town's venue page sees ONLY events whose `event_code` is
exactly `WC26-LONDON-KENTISH`. The umbrella synthetic rollup rows are
excluded by construction. **Umbrella reach / impressions / clicks DO NOT
appear in any venue card today.**

Joe's evidence for Bug #2:

> Kentish Town venue card: reach 481,067, impressions 519,391, spend £2,251.
> Kentish-only Meta UI: reach 331,552, impressions 535,946, spend £2,280.
> Umbrella PRESALE/ONSALE Meta UI: reach 472,423, impressions 878,016, spend £2,645.

Reconciling Kentish impressions (additive):

```
Sum-after-dedup ≈ N_days × per-day per-event impressions
519,391 ≈ Meta UI lifetime 535,946  (within ~3%, well inside the ±5% acceptance band)
```

Reconciling Kentish reach (the same sum-vs-lifetime gap as Manchester):

```
Ratio sum/lifetime = 481,067 / 331,552 ≈ 1.45
```

Lower than Manchester's 2.23× because Kentish has shorter / lower-budget
campaigns and fewer days of overlap, but consistent shape: it's the
sum-of-daily-reach vs Meta UI lifetime-reach gap, NOT umbrella bleed.

**Conclusion on Bug #2:** the architecture Joe wants ("venue cards show
ONLY campaigns whose name bracket matches that specific venue's
event_code") is the architecture today. Umbrella spend is the only thing
that crosses the boundary (and Joe explicitly approved that), and the
allocator runs as `/api/admin/event-rollup-backfill` post-processing
(potentially stale).

---

## 2. Architecture decision

After the trace, we believe the right shape is:

### 2.1 Bug #1 fix — lifetime reach as the canonical venue-card cell

**Add a lifetime-reach cache, populate via a non-incremented Meta API
call, surface as the venue stats grid Reach cell.**

Mechanics:

1. **Schema:** add a per-event_code lifetime-reach cache. Two options:
   - Option A — column on `events`: `meta_reach_lifetime BIGINT`,
     `meta_reach_lifetime_at TIMESTAMPTZ`, mirroring `meta_spend_cached`.
     Requires multi-event venues to write the same number on every
     sibling row (consistent with the campaign-wide nature of the
     metric); the venue page's existing `MAX-by-(event_code, date)`
     instinct extends naturally.
   - Option B — new table `event_code_lifetime_meta_cache`
     (`client_id`, `event_code`, `meta_reach_lifetime`,
     `meta_impressions_lifetime`, `meta_video_plays_lifetime`,
     `fetched_at`). Cleaner conceptually (the metric is per
     `event_code` not per event), avoids the "duplicate write to N
     siblings" confusion.

   **Recommendation: Option B.** The metric is per-`event_code` by
   nature; encoding that in the schema avoids a future maintainer
   summing the column.

2. **Fetch:** new helper `fetchEventLifetimeMetaMetrics({eventCode,
   adAccountId, token})` mirroring `fetchEventDailyMetaMetrics` but with
   NO `time_increment` parameter. Returns one row per matching campaign
   (which we then sum across the `[event_code]`-bracketed campaigns,
   accepting Meta's per-campaign reach is itself deduplicated within the
   campaign). The result IS the venue lifetime reach (sum-across-
   campaigns of campaign-deduplicated reach is approximately Meta's UI
   number — within Meta's own audience-overlap fudge factor).

3. **Cron:** extend `rollup-sync-runner.ts` to also call the lifetime
   helper once per `event_code` per sync (cheap — one Meta call per
   venue, not per event). Today every event in a venue triggers one
   `fetchEventDailyMetaMetrics` call returning campaign-wide data per
   day; the lifetime call is the same shape with one row instead of N
   days, so it's strictly cheaper.

4. **Surface:** `<VenueStatsGrid>` accepts the cached lifetime reach
   directly (e.g. via the loader payload), bypasses the
   `aggregateStatsForPlatform` reach calculation, and renders it as the
   Reach cell. The "(sum)" qualifier disappears from the label. The
   tooltip changes to "Unique users reached across all campaigns
   bracketed `[<event_code>]` — Meta-deduplicated".

5. **Backwards compatibility:** the daily reach column stays on
   `event_daily_rollups` for the trend / tracker (which currently
   doesn't surface it but might in future) and for diagnostics. The
   dedup helper from PR #413 stays — it's still needed for impressions,
   video plays, engagements, meta_regs (all of which ARE additive across
   days, so sum-of-daily IS the right metric for them).

**Why not Option A (re-label without re-source):** the cell is already
labeled "Reach (sum)" with a tooltip. Joe's brief explicitly says
"venue cards must reconcile within ~5% of Meta UI" — a re-label would
NOT meet that acceptance criterion. The number has to change, not the
text.

### 2.2 Bug #2 fix — separate umbrella panel (optional polish, post-Bug-#1)

**No architectural change to per-venue attribution.** The current
`event_code` substring matching plus the venue-page filter already
delivers Joe's "venue cards show ONLY campaigns whose name bracket
matches that specific venue's event_code" requirement.

Optional polish PR (separate scope, lower priority):

- On the three London venue pages (Tottenham / Shoreditch / Kentish),
  add a collapsible panel below the Topline Stats Grid labeled
  "London-wide series campaigns" containing a slim grid of:
  - Spend (umbrella total, attributed to this venue's third)
  - Reach (lifetime, as fetched by the new cache)
  - Impressions (lifetime sum)
  - Clicks
- The panel reads from the umbrella synthetic event rows (which the
  loader would need to surface — currently they're filtered out before
  the venue page sees them).
- This makes the umbrella metrics legible WITHOUT polluting the per-
  venue card numbers, satisfying the spirit of Joe's architectural ask
  even though the strict "bleed" the brief alleges doesn't exist.

**Recommendation: defer the umbrella panel.** Bug #1's "lifetime reach"
fix is the sharp criterion-meeting change. Adding the umbrella panel can
be a follow-up sprint after we've watched a few share-link rounds with
the lifetime reach number to confirm it actually solves Joe's customer-
facing concern.

---

## 3. Implementation arc (post-greenlight)

Two PRs, both off fresh `main`:

### PR A — `cursor/creator/venue-lifetime-reach-cache`

1. Migration `068_event_code_lifetime_meta_cache.sql`:

   ```sql
   CREATE TABLE IF NOT EXISTS event_code_lifetime_meta_cache (
     client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
     event_code text NOT NULL,
     meta_reach_lifetime bigint,
     meta_impressions_lifetime bigint,
     meta_video_plays_3s_lifetime bigint,
     meta_engagements_lifetime bigint,
     fetched_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (client_id, event_code)
   );
   -- RLS: SELECT on own client_id, INSERT/UPDATE service-role only.
   ```

2. New `fetchEventLifetimeMetaMetrics` in `lib/insights/meta.ts`,
   mirroring `fetchEventDailyMetaMetrics` (same `[event_code]` substring
   filter, same case-sensitive post-filter) but no `time_increment` —
   returns one set of totals.

3. `rollup-sync-runner.ts`: after the daily Meta fetch, call the
   lifetime helper once per `event_code` (memoise across siblings —
   first event in the venue triggers the fetch, the rest read the
   cache). Upsert into the new table.

4. `client-portal-server.ts`: extend the venue payload with
   `lifetimeReach`, `lifetimeImpressions`, `lifetimeVideoPlays3s`,
   `lifetimeEngagements`. Read from
   `event_code_lifetime_meta_cache.client_id = clientId AND event_code = X`.

5. `<VenueStatsGrid>`: accept the new fields as props, render
   `lifetimeReach` in the Reach cell (rename label from "Reach (sum)"
   to "Reach", update tooltip). Keep `aggregateStatsForPlatform` for
   spend / impressions / clicks / etc. Plumb through `<VenueFullReport>`.

6. Tests:
   - Unit test for `fetchEventLifetimeMetaMetrics` (Meta API fixture
     mock, asserts the no-`time_increment` shape and the case-sensitive
     post-filter behaviour).
   - Pipeline test extending
     `venue-stats-grid-pipeline-shepherds-bush.test.ts` with two
     additional assertions: (a) when `lifetimeReach` is supplied, the
     Reach cell renders that value verbatim, NOT the daily sum; (b)
     the existing dedup of impressions / video plays still works.
   - Pipeline test pinning Manchester:
     ```
     lifetimeReach = 781_346
     dailyReachPerEvent = 43_840
     dailyDays = 39
     dailyImpressionsPerEvent = 50_186
     ```
     asserts the Reach cell is exactly 781,346 (matching Meta UI ±0)
     and the Impressions cell stays within 5% of Meta UI's 1,972,797.
   - Wire-up tests reading the component sources for the new prop.

7. Backfill script: `app/api/admin/event-code-lifetime-meta-backfill/`
   to populate the cache for existing venues without waiting for the
   next cron tick. Idempotent (matches the rollup backfill pattern).

### PR B — optional: `cursor/creator/london-umbrella-panel`

After PR A ships and we've watched the customer reaction. Adds the
collapsible "London-wide series campaigns" panel on the three London
venue pages. Out-of-scope for this Plan PR; will be specced separately
if Matas wants it.

---

## 4. Acceptance criteria (when PR A lands)

Reproduce in production with:

- [ ] **Manchester** venue card Reach cell shows ≤ 820,000 (Meta UI
  lifetime 781,346 + 5% acceptance band).
- [ ] **Manchester** venue card Impressions cell stays at 1,972,012
  (the post-PR-#413 number, which already reconciles to Meta UI's
  1,972,797).
- [ ] **Kentish Town** venue card Reach shows ≤ 348,000 (Meta UI
  lifetime 331,552 + 5%).
- [ ] **Shepherd's Bush** venue card Reach shows ≤ 184,000 (Meta UI
  lifetime 175,330 + 5%, the figure pinned by PR #413's pipeline test).
- [ ] **Tottenham / Shoreditch** venue cards reach within ±5% of Meta UI
  for their respective `[WC26-LONDON-TOTTENHAM]` / `[WC26-LONDON-SHOREDITCH]`
  campaign-group lifetime reach.
- [ ] DOM-level regression test for each venue (Shepherd's Bush as
  canonical, Manchester + Kentish as the two cited bug venues, plus the
  five spot-check venues already in
  `venue-stats-grid-pipeline-shepherds-bush.test.ts`). Tests assert via
  `data-testid="venue-stats-cell-reach"` markers on the rendered cell.
- [ ] Total Marketing Budget unchanged on every venue (sanity check the
  spend pipeline didn't get touched by accident).
- [ ] No regression on any non-WC26 client (single-event venues should
  pass through unchanged).

PR B's acceptance is just "the umbrella panel renders the right numbers"
and doesn't change any per-venue card; we'll spec it separately.

---

## 5. Open questions for Matas (greenlight items)

1. **Confirm the diagnosis.** Is the "sum-of-daily ≠ lifetime" gap the
   root cause we believe it is? Joe's brief diagnosed it as N-counting;
   our trace says PR #413 fully fixed N-counting and the residual
   discrepancy is the sum-vs-lifetime concept gap. If you want to triple-
   check before I implement, the cheapest test is:
   ```sql
   SELECT
     event_id,
     SUM(meta_reach) AS sum_daily_reach,
     COUNT(DISTINCT date) AS days_count
   FROM event_daily_rollups
   WHERE event_id IN (<4 Manchester event ids>)
     AND meta_reach IS NOT NULL
   GROUP BY event_id;
   ```
   All four rows should return the same `sum_daily_reach` and same
   `days_count`. PR #413's dedup picks ONE of the four to keep on each
   day (MAX-collapse), so post-dedup the venue total = sum_daily_reach
   for ONE event ≈ 1,740,469. If the four rows differ wildly that
   invalidates the diagnosis and we're back to looking at non-dedup
   surfaces.

2. **Schema choice.** Option A (column on `events`) vs Option B (new
   `event_code_lifetime_meta_cache` table). Recommendation: B. Strong
   preference?

3. **Scope of the lifetime cache.** Just reach + impressions + video
   plays + engagements? Or include `link_clicks` and `meta_regs` too?
   (Both ARE additive, so today's daily-sum is correct; the only
   reason to cache them is consistency / faster portal load. Probably
   skip and only cache the columns that aren't additive.)

4. **Umbrella panel (PR B).** Defer or land alongside? Joe's brief
   asks for it as part of Bug #2's architectural ask; my reading is
   the architecture itself is already correct, so the panel is purely
   a UX clarification. Defer feels right but happy to bundle if you'd
   prefer a single Friday ship.

5. **Naming.** Replace "Reach (sum)" with "Reach" (with a tooltip
   explaining "Unique users across the whole campaign window"). OK?
   Or do we want "Lifetime Reach" or "Unique users reached"?

---

## 6. Risks

- **Meta API quota.** One extra Meta call per `event_code` per cron
  tick. Today the cron makes one call per event; the lifetime call is
  one per `event_code` (≤ N events). For a venue with 4 fixtures, this
  is +25% Meta calls. Within current quota headroom (4thefans is well
  under) but worth flagging if we onboard a high-volume client.
- **Stale cache.** If the lifetime backfill cron lags vs the daily
  cron, the venue card's reach could lag the impressions / spend cells
  by ≤ 6 hours. The "last synced" indicator already shows the latest
  source timestamp; we'd just need to pick the older of the two for
  the venue page, OR show two indicators ("lifetime reach as of X,
  daily metrics as of Y"). Minor UX call.
- **Reach across campaigns is approximated.** Meta returns
  per-campaign deduplicated reach; summing across N campaigns under
  one bracketed event_code could overcount users who saw multiple
  campaigns. Meta UI's own cross-campaign reach uses an audience-
  network-level dedup that we cannot replicate without a different API.
  Acceptable per Joe's brief ("within 5% of Meta UI"); for tight
  reconciliation we could call Meta's `breakdown=campaign_name` reach
  API which returns the cross-campaign deduplicated number. Decision
  for Matas: simple sum (good enough for ±5%) or the breakdown API
  (exact match, one extra call per venue).
- **Single API call failure.** If `fetchEventLifetimeMetaMetrics`
  errors, the venue card's Reach cell falls back to "—" rather than
  reverting to the (wrong) sum-of-daily-reach. Fail-safe.

---

## 7. Memory anchors consulted

- `feedback_resolver_dashboard_test_gap.md` — drove the wire-up
  assertions in PR #413's pipeline test; same pattern lands in PR A
  (every new prop gets a `readFileSync` source-string assertion).
- `feedback_collapse_strategy_per_consumer.md` — TBD, not located in
  repo; the principle "different consumers need different aggregations"
  is the heart of this plan. Reach has TWO consumers: the venue card
  (wants lifetime) and the trend chart (wants daily). The current
  code conflates them.
- `feedback_snapshot_source_completeness.md` — TBD, not located in
  repo. The lifetime cache is a snapshot-style write; its source
  completeness guarantee is "one Meta lifetime call per event_code
  per cron tick".

---

## 8. What is OUT of scope for this plan

- Funnel pacing benchmark explainer UI (separate Cursor Sonnet task,
  Friday).
- Interactive spend slider (Joe asked, deferred to next sprint).
- TikTok / Google Ads lifetime reach (none of those clients have
  multi-event venues today; extend `event_code_lifetime_*_cache` when
  the first one hits production).
- WC26-LONDON-PRESALE / -ONSALE allocator behaviour. The current
  3-way spend split is correct per Joe's spec; if `wc26-london-split.ts`
  hasn't been re-run recently the spend numbers may be stale, but that's
  an ops issue (re-run `/api/admin/event-rollup-backfill`), not a code
  bug. Flagged for Matas: should the london-split allocator be folded
  into the regular cron rather than admin-triggered?

---

## 9. Decision needed by

11:00 UK Wednesday 2026-05-14, per Joe's brief.

Slack to Matas with this doc + the §5 questions; PR A coding starts on
greenlight.
