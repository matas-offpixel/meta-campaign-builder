# Client Dashboard Brief — 4theFans Rollout + Cross-Event View

Date: 2026-04-27
Author: Matas (briefed via Cowork session)
Status: Draft brief for Cursor — open questions flagged at end

---

## Implementation Status — 2026-04-29 Overnight Update

The client dashboard is now past the original skeleton phase and has a production data path for the 4theFans rollout:

- **Venue allocator:** multi-event venue spend uses the three-tier allocator: ad-level attribution, campaign-level synthetic remainder reconciliation, and historical window extension for allocator-owned fields such as `link_clicks`. This is the source of truth for expanded venue paid-media rows.
- **Trend chart:** event reports and venue cards share `EventTrendChart`, with pure aggregation logic in `lib/dashboard/trend-chart-data.ts`. Metric pills use lifetime totals for additive metrics and derived lifetime averages for ratios. Ticket data preserves the additive-vs-cumulative snapshot distinction.
- **Portal loader pagination:** `event_daily_rollups` must always be range-paginated because PostgREST silently caps unpaginated selects at 1,000 rows. The same rule now applies to other growth tables used by the portal loader, including tracker entries, ticket snapshots, and additional spend.
- **Daily budgets:** the venue daily-budget API is already protected by a 1-hour in-memory TTL and stale-while-revalidate behavior. Cached stale values return immediately while the route refreshes Meta in the background.
- **Venue shares:** migration 055 allows `report_shares.scope = 'venue'`, and the venue share route uses the service role after token validation so public client-token minting does not trip RLS.

Recent verification anchor for Bristol after allocator rerun: Spend approximately £2,476, Tickets 517, CPT approximately £4.79, and Clicks approximately 18,169-29,531 depending on the exact post-rerun window and Meta link-click source in the live data.

Current overnight PRs:

- `#159` fixes null-date multi-event venue groups such as Manchester and Margate so they no longer skip allocation.
- `#162` paginates additional client portal growth-table reads.
- `#163` removes the orphaned old share-side Daily Tracker component.
- `#165` fixes the venue-table hash expansion hydration mismatch.

---

## Context

We have working per-event dashboards (e.g. Leeds FA Cup SF, Arsenal CL SF) showing live spend / tickets / creatives / pacing — both internal Reporting tab and `/share/report/[token]` external view, with client-editable additional spend. Architecture documented in earlier session handovers (Apr 24).

This brief covers two phases:

- **Phase 1 — Roll the per-event dashboard out to every 4theFans event**, handling mixed ticketing data sources (Eventbrite where applicable, 4thefans internal API when ready, manual entry interim).

- **Phase 2 — Build a client-level dashboard** that aggregates across all of a client's events: topline ad-account stats, best/least performers, top creatives + campaigns cumulatively, drill-through to individual event reports.

Designed so the same architecture serves any future client, not 4theFans-specific.

---

## Phase 1 — Event Dashboard Rollout

### 1.1 Catalogue 4theFans events

Identify every 4theFans event that should have a dashboard. Today only Leeds + Arsenal are seeded with current architecture. Need to:

- Query `events` where `client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'` (4theFans) — list all current + upcoming events.
- For each, classify ticketing data source:
  - **Eventbrite-linked** — events where the venue uses Eventbrite (typically O2 Academy series). Check existing `client_ticketing_connections` + per-event `event_ticketing_links`.
  - **4thefans internal API** — events sold via `4thefans.tv`. API connection is in development (Russ, expected within ~2 weeks).
  - **Other / unknown** — needs operator clarification before a dashboard goes live.

- Standardise `events.event_code` (must be `[BRACKETED]` capital-snake convention, e.g. `4TF26-LIVERPOOL-CL`) — this is load-bearing for Meta campaign aggregation. Audit any existing event_codes for consistency. Fix mismatched ones.

### 1.2 Per-event readiness checklist

Each event needs:

- `events.event_code` set, capitalised, bracket-friendly substring.
- `events.capacity` populated (else sell-through can't compute).
- `events.general_sale_at` populated (drives Daily Tracker presale bucket logic).
- `events.event_date` set (drives days-until-event pacing).
- `clients.meta_ad_account_id` populated for the parent client (already done for 4theFans: `10151014958791885`).
- Ticketing connection (one of):
  - **Eventbrite** — `client_ticketing_connections` row exists + `event_ticketing_links` row pointing at the Eventbrite event id.
  - **4thefans internal** — placeholder connection that flips to API-mode once their endpoint goes live (see 1.4).
  - **Manual** — no connection; operator enters tickets sold + revenue per day via UI.

- Meta campaigns named with the `[event_code]` prefix (e.g. `[4TF26-LIVERPOOL-CL] TRAFFIC ADS`). Audit + rename any non-conforming live campaigns.

- `report_shares` row generated, `can_edit = true`, ready to send to client.

### 1.3 Bulk seeding tooling

Build a thin internal admin tool to:

- List all events for a client side-by-side with their readiness checklist (ticketing connection / event_code / share token / sync status).
- One-click "Generate share link" + "Initial sync now" + "Audit Meta campaign names" actions.
- Surface readiness warnings inline ("No ticketing connection — tracker will be empty").
- Output a copy/paste table Matas can WhatsApp the client with all share URLs.

Lives at `/clients/[id]/events-rollout` or similar.

### 1.4 Manual ticketing fallback (interim for 4thefans pre-API)

Until 4thefans API ships, events using their internal ticketing have no automated daily ticket data. Build a manual entry path:

- Per-event Daily Tracker gets an "Enter today's tickets" inline editor when `client_ticketing_connections.provider = 'manual'` (new enum value).
- Operator types day spend (auto-pulled from Meta), tickets sold, revenue. Saves to `daily_tracking_entries` (already exists since migration 025).
- Migration pattern: when the 4thefans API connects later, switch `provider = 'foursomething_internal'` and the rollup-sync runner reads from API. `daily_tracking_entries` rows stay as historical truth (manual wins per existing timeline merge logic).

- Acceptable degraded state: events show Meta spend + manual tickets, no real-time live-ticket counter. Flag this prominently on the event page ("Manual ticketing — auto-sync will switch on once 4thefans API connects").

### 1.5 4thefans API connection (when ready)

Stub now, complete later. Add a new ticketing provider adapter `lib/ticketing/foursomething/` (or similar name) mirroring `lib/ticketing/eventbrite/`:

- `client.ts` — auth + base URL (encrypted credentials via existing `set_ticketing_credentials` RPC from migration 038).
- `orders.ts` — daily aggregator. Same shape as Eventbrite returns: `[{ date: 'YYYY-MM-DD', tickets: N, revenue: GBP }]`.
- Wire into `lib/dashboard/rollup-sync-runner.ts` as a third leg alongside Meta + Eventbrite.

Ask Russ for the spec when ready. Minimum viable surface:

- An endpoint that returns per-day ticket counts + gross revenue for a given event id, optionally filtered by date range.
- Auth via API key in header (passed through encrypted credentials).
- No webhook needed for v1; pull-based on existing 6-hourly cron is fine.

---

## Phase 2 — Client-Level Dashboard

### 2.1 Goals

A single page per client showing:

- Topline ad account performance across all of their events (lifetime + selectable timeframes).
- Active and recent events at a glance with per-event KPIs.
- Cross-event "best / worst performers" rankings.
- Cross-event "top creatives" — concepts that delivered most across all events.
- Cross-event "top campaigns" — campaign types ranked.
- Click-through to per-event reporting.

Used by:

- **Internal** — Matas's primary daily view at `/clients/[id]/dashboard`.
- **External** — clients view via `/share/client/[token]` with a `scope = 'client'` token (existing schema in `report_shares`, currently rejected by mutating routes; reads OK).

Same React component palette serves both. SSR loads data; client surface determines which writable controls render.

### 2.2 Layout (single scroll page)

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
│ 4theFans · Client Dashboard                  [Share link · ⚙]  │
│ N active events · M past 30 days                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ TIMEFRAME PILLS                                                 │
│ All time · Past 30 days · Past 14d · Past 7d · Past 3d · Today │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ TOPLINE — AD ACCOUNT STATS                                      │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ Spend   │ │ Tickets │ │ Revenue │ │ ROAS    │ │ Avg CPT │    │
│ │ £X      │ │ N sold  │ │ £Y      │ │ Z.ZZx   │ │ £A      │    │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│                                                                 │
│ Sub-line: across N events · M live · L past · K upcoming        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ACTIVE EVENTS (live + upcoming)                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Leeds FA Cup SF · 26 Apr · O2 Academy Leeds · Eventbrite    │ │
│ │ 1,219 / 1,800 (67.7%) · £2,041 spent · CPT £1.67 · ROAS 6.4x│ │
│ │ 2 days left · Pacing: needs +X tickets/day                  │ │
│ │                                          [View report →]    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Arsenal CL SF · 30 Apr · ... etc                            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [Show past events ↓]                                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ BEST / WORST PERFORMERS                                         │
│ Sort by: [ROAS ▾]  [CPT]  [Sell-through %]  [Pacing delta]     │
│                                                                 │
│ TOP 3                          BOTTOM 3                         │
│ 1. Liverpool CL — ROAS 8.2x   1. Tottenham — ROAS 0.9x          │
│ 2. Leeds FA — ROAS 7.5x       2. Wolves — ROAS 1.4x             │
│ 3. Arsenal CL — ROAS 6.4x     3. Brighton — ROAS 1.7x           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ TOP CREATIVES (cumulative across all events, current timeframe) │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                            │
│ │ Concept │ │ Concept │ │ Concept │                            │
│ │ £X spent│ │ £Y spent│ │ £Z spent│                            │
│ │ N events│ │ M events│ │ K events│                            │
│ │ Health  │ │ Health  │ │ Health  │                            │
│ └─────────┘ └─────────┘ └─────────┘                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ TOP CAMPAIGNS (by type, summed across events)                   │
│ TRAFFIC ADS    £X spent · N tickets · CPT £A · Health: SCALE    │
│ CONVERSIONS    £Y spent · M tickets · CPT £B · Health: OK       │
│ PRESALE        £Z spent · K signups · CPR £C · Health: ROTATE   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Topline ad-account block — data source

Aggregate across all events for the client where `events.client_id = X`:

- Sum `event_daily_rollups.ad_spend` for the timeframe across all events for the client → "Spend"
- Sum `event_daily_rollups.tickets_sold` → "Tickets"
- Sum `event_daily_rollups.revenue` → "Revenue"
- Sum `additional_spend_entries.amount` → adds to "Total Marketing" but NOT to ROAS denominator (ROAS is paid-media-driven)
- ROAS = Revenue / Sum(Meta spend)
- Avg CPT = Sum(Meta spend) / Sum(tickets)
- Cache server-side for 5 min keyed on `(client_id, timeframe)`.

This deliberately doesn't pull directly from Meta Insights at the ad-account level — we use rollup data so it stays consistent with per-event numbers. Alternative would be ad-account-level Insights query, but that includes campaigns NOT bracketed `[event_code]` and would skew totals.

### 2.4 Active events list

Query: events where `event_date >= today - N days` (configurable, default 30) sorted by `event_date asc` for upcoming, `event_date desc` for recently-past.

Each card shows:

- Event name + date + venue
- Ticketing source badge (Eventbrite / 4thefans / manual)
- Sold / capacity (sell-through %)
- Spent (Meta + Other split if Other > 0)
- CPT
- ROAS
- Days until event
- Pacing summary line (one-liner from existing `computeSellOutPacing`)
- "View report" button → links to internal `/events/[id]/reporting` (when called from internal client dashboard) OR `/share/report/[event_token]` (when called from external client share view — needs per-event tokens existing).

Past events render compactly in a collapsed section.

### 2.5 Best / worst performers

Operator-selectable sort metric: ROAS, CPT, sell-through %, pacing delta (actual sold vs needed-to-date), creative health average.

Show top 3 + bottom 3 events for the selected metric. Each row: event name, metric value, deep-link to event.

### 2.6 Top creatives across events

Aggregate `active_creatives_snapshots` (or live Meta query, depending on which path is faster) across all events for the client. Group by **creative concept name** (matching the existing per-event grouping logic in `lib/reporting/active-creatives-group.ts`).

Per-concept stats:

- Total spend across events
- Total impressions / clicks / LPV
- Total purchases / regs
- Number of events used in
- Aggregated health badge (recompute frequency × CTR off the summed totals)
- Top 3 events the concept ran in

Useful for spotting evergreen concepts that work universally vs event-specific high performers.

### 2.7 Top campaigns by type

For each of the standard campaign types in their workflow (`TRAFFIC ADS`, `PRESALE`, `CONVERSIONS ADS`, plus any custom types they use), aggregate across all events for the client:

- Total spend
- Total tickets driven (using `[event_code]` substring → join to events for ticket attribution)
- CPT
- Health pill (averaged across events)

This shows whether the operator's standard playbook is working in aggregate, not just per event.

### 2.8 Routing

- `/clients/[id]/dashboard` — internal agency view, full controls
- `/share/client/[token]` — external client view, read-only by default; `can_edit=true` could later allow client to view-but-not-edit per-event
- Per-event clicks from either go to the appropriate per-event report (internal or share)

`report_shares` already supports `scope = 'client'` — extend by-share-token routes if any need to be client-scoped (e.g. additional spend at client-level? probably no — that stays per-event).

### 2.9 Permissions / RLS

- All client-dashboard reads gated by `events.client_id` filter on top of per-row RLS by `user_id` for authenticated callers.
- Client share token resolves a client_id and a user_id; service-role client reads scoped to that pair.
- No cross-client data leakage even if token is malformed.

---

## Phase 3 — Implementation Plan

### 3.1 PR sequencing (recommended)

1. **PR A — Catalogue + readiness audit**
   - Internal admin page listing 4theFans events with readiness checks
   - Bulk share-token generation
   - Read-only; no new tables

2. **PR B — Manual ticketing provider**
   - New `provider = 'manual'` enum value on `client_ticketing_connections.provider` (or equivalent column)
   - UI to add per-day ticket sold + revenue on event Daily Tracker
   - Route: `POST /api/events/[id]/manual-tickets` writing `daily_tracking_entries`
   - Existing timeline merge logic handles the rest

3. **PR C — Client dashboard skeleton**
   - Routes: `/clients/[id]/dashboard` + `/share/client/[token]`
   - Topline ad-account stats block
   - Active + past events list (read-only cards, deep links)
   - SSR data fetch + 5-min cache

4. **PR D — Best/worst performers + sort**
   - Adds the ranking block to the dashboard skeleton

5. **PR E — Top creatives across events**
   - Cross-event creative aggregation
   - Concept grouping using existing `active-creatives-group` helper extended to multi-event input

6. **PR F — Top campaigns by type**
   - Aggregates campaign-type totals across events
   - Reuses existing health-badge logic

7. **PR G — 4thefans API adapter** (when Russ delivers)
   - New ticketing provider in `lib/ticketing/foursomething/`
   - Migration to add the provider enum value
   - Wired into rollup-sync-runner

Each PR = one fresh branch off latest main (per branch-hygiene rule from PR #110). Land sequentially or interleaved; PR A + B can land in parallel.

### 3.2 Data model additions (likely)

- `client_ticketing_connections.provider` enum extension to include `'manual'` and `'foursomething_internal'` (or whatever 4thefans calls it).
- Optional: a new `client_dashboard_snapshots` table for cross-event aggregates if 5-min server cache isn't enough at scale. Defer until needed.
- No changes to `events`, `event_daily_rollups`, `additional_spend_entries`, or `report_shares` schema.

### 3.3 Caching strategy

- Per-event data already cached at `(event_id, timeframe)` key — leave alone
- Client-level aggregates cached at `(client_id, timeframe)` key, 5-min TTL
- Refresh button on client dashboard triggers `/api/clients/[id]/refresh?force=1` which:
  - Fans out rollup-sync to every active event for the client (in parallel, `Promise.allSettled`)
  - Then busts the client-level cache
  - Returns combined diagnostics (which events synced OK, which failed)

### 3.4 Error states / degraded modes

- Events with no ticketing connection: show "Manual entry required" prompt on event card, link to fix
- Events with stale rollup data (last sync > 12h ago): badge "stale"
- Events without `event_code` set: hidden from rankings, surface in admin readiness audit
- Client with zero events: empty state with CTA to create an event

### 3.5 Future considerations (out of scope but worth noting)

- CRM signup matching (already in backlog from earlier session)
- Cross-client benchmarks (e.g. "your CPT is X% above other dance event clients") — needs anonymisation logic, defer
- Ad-account-level Meta Insights query as alternative to rollup-summed totals — useful if non-bracketed campaigns also need to surface, defer
- Per-creative cross-event modal: click a top creative → see every event it ran in with mini stats
- Predictive pacing: ML projection of final sell-through given current trajectory — separate project

---

## Confirmed Decisions

Matas confirmed all 8 questions (2026-04-27):

1. **Client share URL** — single client-level share URL via `/share/client/[token]`. Read-only for now; per-event editing via deep-links into per-event share URLs.

2. **Manual ticketing UI** — both inline per-row Daily Tracker editor AND a bulk catch-up page (e.g. `/events/[id]/manual-tickets` showing 14-30 days at once for backfill).

3. **Active events lookback** — default last 30 days past + all upcoming. "Show more past events" CTA loads older ones in batches of 30 days.

4. **Pacing delta target** — S-curve weighted toward final weeks (sales accelerate as event approaches). Implementation: weight a logistic curve so day-N expected % = `1 / (1 + exp(-k * (day-midpoint)))` where midpoint = total campaign days × 0.7. Tune `k` based on observed historical curves; default `k = 0.15` for a typical 60-day campaign. Keep linear as a fallback when there's no defined campaign start.

5. **Top creatives scope** — strictly within the client. No cross-client leakage on client-facing dashboards. Cross-client view (if ever needed) lives only on Off/Pixel internal admin, not client dashboards.

6. **4thefans API spec** — already shared with Russ. No action needed here.

7. **Priority order** — ship sequentially A → G. PR A (audit) + PR B (manual ticketing) first to unblock 4thefans event rollout, then PR C-F build the client dashboard, PR G when Russ's API lands.

8. **Generic-from-day-one** — confirmed. All Phase 2 components scoped by `client_id` so any future client (Louder, Junction 2, etc.) inherits the dashboard when their events come online.

---

## Summary

Phase 1 makes every 4theFans event match the Leeds/Arsenal pattern, with manual ticketing fallback for events that aren't on Eventbrite while we wait for Russ's API. Phase 2 layers a client-level dashboard on top, aggregating from rollup data so numbers stay consistent with per-event views. The architecture extends to any future client without 4thefans-specific assumptions.

Estimated complexity: 7 PRs, ~3-5 days end-to-end depending on Cursor turnaround and Matas's testing cadence. PR A (audit) and PR B (manual ticketing) unblock Joe's other 4thefans events immediately; PR C-F (client dashboard) ship sequentially; PR G ships when Russ's API lands.
