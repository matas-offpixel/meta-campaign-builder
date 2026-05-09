# Cursor Mega Prompt — Data Reconciliation + Cmd+K Search 2026-05-09

**Recommended model: Opus 4.7.** This bundle restructures the dashboard's revenue-resolution path, audits the channel-sales write contract on the fourthefans connector, backfills tier_channel_sales for 4 events, and ships a new global Cmd+K palette. Three of those four touch load-bearing data paths. Sonnet 4.6 will under-handle the source-priority fallback edges (we hit this on PR #297/#298). Opus closes it in one session.

**Estimated Cursor runtime:** 90-120 min. ~$8-12 of API spend.

**Combined because:** all four work streams touch independent files. Data-fix PRs land first (top-line numbers must be right before Joe's Monday walkthrough). Cmd+K is fully orthogonal — adds new files, modifies layout once. Single Cursor session, no rebase tax.

---

## Background you need to load before touching code

Three docs in `/docs/`:
- `STRATEGIC_REFLECTION_2026-05-08.md` — current arc context
- `META_API_BOTTLENECKS_2026-05-08.md` — perf push state
- Read `CLAUDE.md` at repo root for the load-bearing rules (snapshot contracts, retry policy, branch hygiene)

Three memory anchors that matter:
- `project_meta_reconciliation_drift_findings_2026-05-05` — the cross-reference function (`meta_reconcile_event_spend`) that confirmed reporting accuracy. Use the same audit pattern after each fix here.
- `project_4thefans_dashboard_arc_2026-05-08` — the two-writer pattern (history backfill writes ticket_sales_snapshots, live rollup writes tier_channel_sales). The bug we're fixing is the live rollup not writing to tier_channel_sales for some venue shapes.
- `feedback_cleanup_migration_preserve_reconstruct` — never null-and-refill. If we backfill tier_channel_sales for CL Final, reconstruct from event_ticket_tiers, don't drop existing data.

---

## Diagnostic state at start of session

The user has already verified via SQL:

**CL Final London (4TF26-ARSENAL-CL-FL) — broken:**
| Venue | snap_tickets | tier_qty_sold | tier_revenue | tier_channel_sales |
|---|---|---|---|---|
| Lock Warehouse | 398 | 398 | £8,135 | EMPTY |
| Outernet | 452 | 1,351 (sums 2 listings) | £21,555 | EMPTY |
| TOCA Social | 68 | 68 | £949 | EMPTY |
| Village Underground | 795 | 795 | £14,281 | EMPTY |

True CL Final revenue: **£44,920**. Dashboard displays **£102,686** (legacy fallback). All 4 events are populated correctly in `event_ticket_tiers` and `ticket_sales_snapshots` but never made it to `tier_channel_sales`.

**Manchester WC26 — partially populated, dashboard reading wrong source:**
| Event | tier_channel_sales tickets | tier_channel_sales revenue | Dashboard top-line |
|---|---|---|---|
| England v Croatia | 356 | £3,069 | reads 246 (fourthefans snapshot) |
| England v Panama | 540 | £4,984 | reads 343 |
| England v Ghana | 71 | £962 | reads 71 |
| England Last 32 | 39 | £186 | reads 39 |

Manchester dashboard is showing 699 total when tier_channel_sales sums to 1,006. Real Manchester is **higher** than displayed.

**event_ticketing_links shape (verified):**
- All CL Final venues except Outernet have 1 link (correct)
- Outernet has 2 links (18147 + 18155, pre-reg merge per PR #347)
- All Manchester events have 1 link each at Depot Mayfield (external IDs 33/46/61/76)

**Available 4thefans channels:** 4TF, CP, DS, Eventbrite, Other, SeeTickets, Venue. Manchester sales currently land in 4TF + Venue. CL Final venues haven't been routed to a channel yet.

---

## Copy block — paste this entire block into Cursor as one prompt

````
You are landing 4 work streams in one bundle for Off/Pixel's 4thefans dashboard. Strategic context:
- /docs/STRATEGIC_REFLECTION_2026-05-08.md
- /docs/META_API_BOTTLENECKS_2026-05-08.md
- /docs/CURSOR_PROMPT_DATA_FIX_AND_CMDK_2026-05-09.md (this file's full diagnostic table)
Read them BEFORE touching code so you understand the why.

==============================================================================
NON-NEGOTIABLES (do not violate any of these)
==============================================================================

1. NEVER null-and-refill tier_channel_sales. When backfilling, INSERT new rows preserving any existing rows for the same event. Reference: feedback_cleanup_migration_preserve_reconstruct.md.
2. The two-writer pattern is load-bearing: history backfill writes ticket_sales_snapshots, live rollup-sync writes tier_channel_sales. Never collapse them.
3. Source priority resolver order is manual > xlsx_import > eventbrite > fourthefans (collapse rules in lib/db/event-history-collapse.ts). Don't change priority order.
4. Service-role client (`createServiceRoleClient()`) for any cross-event mutation. NEVER user-scoped Supabase client for backfill writes.
5. Every new PR opens off fresh `main`. Branch protection still off — never commit directly to main.
6. Use `gh pr merge <N> --auto --squash --delete-branch` to close each PR.
7. Do NOT touch the perf bundle work shipped Friday (PRs #360-#365). The cron grid + DB cache are working.
8. Do NOT modify the Meta retry policy in lib/meta/client.ts. Out of scope for this bundle.

==============================================================================
PR-1 — fix/cl-final-tier-channel-sales-backfill
==============================================================================

GOAL: All 4 CL Final London venues (4TF26-ARSENAL-CL-FL) have populated event_ticket_tiers but EMPTY tier_channel_sales. Dashboard's revenue card falls through to legacy calc and displays £102,686 vs actual £44,920. Backfill the missing rows AND fix the connector path that should have written them.

INVESTIGATION:
1. Read lib/ticketing/fourthefans/parse.ts — confirm tier shape detection paths.
2. Read lib/ticketing/fourthefans/provider.ts — find where tickets get routed to tier_channel_sales (search "replaceEventTicketTiers" and "tier_channel_sales").
3. Read lib/dashboard/rollup-sync-runner.ts — find the write path from event_ticket_tiers → tier_channel_sales (this is the bridge the connector should call).
4. Compare with Bristol/Brighton/Glasgow events that DO populate tier_channel_sales correctly (channels Venue/CP). Diff their connector path vs CL Final.

ROOT CAUSE HYPOTHESIS to verify:
- CL Final venues (Lock/Outernet/TOCA/Village) are new (added 2026-05-08) and don't have a `tier_channels.channel_name` mapping configured for "fourthefans automatic write".
- The runner skips writing to tier_channel_sales when no automatic channel is configured for the venue.
- Bristol/Brighton/Glasgow have "Venue" or "CP" channel auto-write configured, so they populate correctly.

CHANGES:

1. Find the channel-routing logic. Likely in lib/dashboard/rollup-sync-runner.ts or lib/ticketing/fourthefans/. The contract should be: "for each tier in event_ticket_tiers for this event, write a tier_channel_sales row with channel_id = the client's automatic channel for the active provider".

2. If a venue has no channel auto-mapping, the fix is one of:
   (a) Default to the client's "Venue" channel (id b1e88c33-cac9-47d5-a6c3-5deb5ee03908 for 4thefans actually — verify the channel_name and use the lookup, don't hardcode IDs).
   (b) Create a new automatic channel like "4TF" if Venue doesn't fit.
   (c) Use the existing "4TF" channel (id 435e9fe5-9e2e-47ba-8270-2d722ca00301) since fourthefans IS the connector.
   
   GO WITH (c) — fourthefans-sourced revenue belongs in the "4TF" channel by definition. The "Venue" channel is for manual/door sales. Verify that's right by reading how Manchester WC26 events route (Manchester has tier_channel_sales rows in BOTH 4TF and Venue channels — fourthefans rows go to 4TF, manual rows go to Venue).

3. Patch the runner so when it can't resolve a per-tier channel, it defaults to the "4TF" automatic channel for fourthefans-sourced sales.

4. Add a one-shot SQL migration `supabase/migrations/088_cl_final_tier_channel_backfill.sql` that:
   ```sql
   -- Backfill tier_channel_sales for the 4 CL Final London venues
   -- Reconstructs from existing event_ticket_tiers (single source of truth post-PR #347).
   -- Idempotent via the natural key (event_id, tier_name, channel_id).
   INSERT INTO tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, snapshot_at)
   SELECT 
     ett.event_id, 
     ett.tier_name,
     (SELECT id FROM tier_channels WHERE channel_name = '4TF' AND client_id = (SELECT client_id FROM events WHERE id = ett.event_id)) AS channel_id,
     ett.quantity_sold,
     ett.price * ett.quantity_sold,
     NOW()
   FROM event_ticket_tiers ett
   JOIN events e ON e.id = ett.event_id
   WHERE e.event_code = '4TF26-ARSENAL-CL-FL'
     AND ett.quantity_sold > 0
     AND NOT EXISTS (
       SELECT 1 FROM tier_channel_sales tcs 
       WHERE tcs.event_id = ett.event_id 
         AND tcs.tier_name = ett.tier_name
         AND tcs.channel_id = (SELECT id FROM tier_channels WHERE channel_name = '4TF' AND client_id = (SELECT client_id FROM events WHERE id = ett.event_id))
     );
   ```
   Verify NOT EXISTS clause works as the dedupe key — confirm by SELECT-ing the union before INSERT, expected ~32 rows added across 4 events (Lock 10 tiers, Outernet 7 tiers, TOCA 7 tiers, Village 8 tiers).

5. Apply the migration via Supabase MCP from the runner.

6. Verify with the same diagnostic SQL in this file under "CL Final London — broken" — tier_channel_sales now sums to £44,920 across 4 venues.

7. Add a unit test in lib/dashboard/__tests__/tier-channel-fallback.test.ts that asserts: when a tier exists with no explicit channel mapping, the fourthefans connector writes to the client's "4TF" automatic channel.

ACCEPTANCE:
- Dashboard /clients/[4tf-id]/venues/4TF26-ARSENAL-CL-FL shows revenue £44,920 (or close to it given any newer sales).
- Migration 088 applied via Supabase MCP.
- Test passes. Build clean.

==============================================================================
PR-2 — fix/manchester-wc26-source-priority
==============================================================================

GOAL: Manchester WC26 events have correct tier_channel_sales data (Croatia 356, Panama 540, Ghana 71, Last 32 39 = 1,006 tickets, £9,201 revenue) but the dashboard top-line shows the latest fourthefans ticket_sales_snapshots count instead (699). The display is reading the wrong source.

INVESTIGATION:
1. Read lib/db/client-portal-server.ts — find where the venue-level "tickets sold" displayed on the dashboard top-line is derived. Search for "699" wouldn't help (it's computed); search for "tier_channel_sales" reads.
2. Read components/share/client-portal-venue-table.tsx — `aggregateVenueCampaignPerformance` and any function that computes per-venue tickets count.
3. Compare with Bristol/Brighton/Glasgow events that show correct numbers — they have similar tier_channel_sales coverage. Why does Manchester behave differently?

ROOT CAUSE HYPOTHESIS to verify:
- The dashboard is using `latestTicketSnapshotByEvent` (from ticket_sales_snapshots) as the primary source, falling through to `tier_channel_sales` only when the snapshot is missing.
- This worked when fourthefans was authoritative. But for Manchester, tier_channel_sales has MORE complete data (it was xlsx-imported with full tier breakdown) than ticket_sales_snapshots (which only sees what fourthefans connector returns).
- Need to invert priority: when tier_channel_sales for an event has more tickets than the latest snapshot, use tier_channel_sales as the truth.

CHANGES:

1. Add a "max(snapshot, tier_channel_sum)" resolver in lib/dashboard/portal-event-spend-row.ts (or wherever per-event tickets gets resolved). Pseudocode:
   ```ts
   const snapshotTickets = latestTicketSnapshotByEvent.get(eventId) ?? 0;
   const tierChannelTickets = tierChannelSalesByEvent.get(eventId)?.totalTickets ?? 0;
   const resolvedTickets = Math.max(snapshotTickets, tierChannelTickets);
   ```
   This is safe because:
   - tier_channel_sales is itself a sum across channels including manual entries
   - it cannot under-report (it's the union of all known sales)
   - if fourthefans is ahead (live sales updates), it wins via the snapshot path
   - if tier_channel_sales is ahead (manual/xlsx import), it wins via the union path

2. Same Math.max logic for revenue: max(latest_snapshot.revenue OR derived from snapshot.tickets × ticket_price, tier_channel_sales sum).

3. Add a unit test in lib/dashboard/__tests__/event-tickets-resolver.test.ts that asserts:
   - When snapshot=246 and tier_channel_sales=356, resolver returns 356.
   - When snapshot=600 and tier_channel_sales=540, resolver returns 600.
   - When tier_channel_sales is empty, resolver returns snapshot value.
   - When both are zero, returns 0.

4. After deploy, verify the Manchester venue card shows 1,006 tickets across 4 events (or current actual if numbers moved).

ACCEPTANCE:
- /clients/[4tf-id]/venues/WC26-MANCHESTER shows 1,006+ tickets (vs 699 today) and £9,201+ revenue (vs current display).
- All 21 4thefans events still show their correct lifetime numbers — no regressions on the events that were already correct.
- Tests pass. Build clean.

==============================================================================
PR-3 — fix/fourthefans-tier-shape-coverage-manchester
==============================================================================

GOAL: Even after PR-2, fourthefans connector is pulling 246 tickets for Croatia and 343 for Panama from the live API. Real numbers (per tier_channel_sales) are 356 and 540. Connector is missing some sales. Likely a tier-shape parsing gap on Manchester listings — same class of bug as PR #348 but on a different venue's tier structure.

INVESTIGATION:
1. Add raw response logging to lib/ticketing/fourthefans/provider.ts (truncate to 5KB) — same pattern as PR #348.
2. Manually fetch one Manchester event via the fourthefans API:
   ```
   GET https://api.fourthefans.com/events/46/sales?from=2026-04-01&to=2026-05-09
   GET https://api.fourthefans.com/events/61/sales?from=2026-04-01&to=2026-05-09
   ```
   Use the user_facebook_tokens.provider_token equivalent for fourthefans. The token user_id is b3ee4e5c-44e6-4684-acf6-efefbecd5858, account/connection_id can be derived from event_ticketing_links.connection_id where event has external_event_id IN ('46', '61').
3. Diff the parser output against the raw response. Look for tier keys the parser doesn't try yet.

ROOT CAUSE HYPOTHESIS:
- Manchester events at Depot Mayfield have a tier shape like `tier_groups: [{ tickets: [...] }]` or similar nested structure that the parser's current key-tries don't reach.
- OR the API is paginated for high-sales events and the parser is reading only page 1.

CHANGES:
1. Expand `readTicketTiers` in lib/ticketing/fourthefans/parse.ts to try additional key paths. Add at least:
   - `tier_groups.*.tickets`
   - `groups.*.tickets`
   - `categories.*.tickets`
   - any other shape surfaced by the raw payload diff
2. If pagination is the issue: add a `next_cursor` follow-through loop in lib/ticketing/fourthefans/api.ts that continues fetching until the API returns no cursor.
3. Add a parser test in lib/ticketing/fourthefans/__tests__/parse-manchester.test.ts using the captured raw payload as fixture.

ACCEPTANCE:
- After deploy + a manual `POST /api/ticketing/rollup-sync` for Manchester events, fourthefans-sourced ticket counts in tier_channel_sales match or exceed the values that PR-2's resolver picks up.
- Once PR-3 lands, PR-2's max() should converge — i.e. snapshot and tier_channel_sales should agree within a margin (since both pull from the same source).
- Test passes. Build clean.

==============================================================================
PR-4 — feat/cmd-k-global-search
==============================================================================

GOAL: Add a Cmd+K (Cmd+P fallback for power-users, Ctrl+K on Linux/Win) global command palette. Lets the user jump to any client or event from any page in the app. The user is currently navigating multiple events daily and the lack of quick search is a friction point.

WHERE:
- New component `components/dashboard/cmd-k-palette.tsx`
- New route `app/api/internal/search-index/route.ts`
- Mount the palette globally in `app/(dashboard)/layout.tsx` (or wherever the dashboard layout lives — verify by grep).

CHANGES:

1. New API route `GET /api/internal/search-index`:
   - Auth: regular user session (cookie-bound).
   - Returns a slim search index of all clients + events the user owns:
     ```ts
     {
       clients: Array<{ id, name, slug, type }>,
       events: Array<{ 
         id, name, slug, event_code, venue_name, venue_city,
         client_id, client_name, event_date, status 
       }>
     }
     ```
   - RLS-scoped to the caller. Service-role NOT used here.
   - Response cached client-side for 5 min (return `Cache-Control: private, max-age=300`).
   - Use the existing `clients` and `events` table reads — no new schema needed.

2. New `<CmdKPalette />` component:
   - Listens for keyboard event `Cmd+K` (or `Ctrl+K`) globally.
   - On open: full-screen modal overlay (use existing modal pattern from share-creative-preview-modal.tsx for consistency).
   - Single text input at top.
   - Below input: filtered list of results, max 10 visible at a time, scroll for more.
   - Search algorithm: client-side fuzzy match on name + slug + event_code + venue_name. Use `fuse.js` if available, else hand-rolled substring + token-overlap scoring.
   - Result groups: "Clients" first (alphabetical), then "Events" (most recent event_date first).
   - Click a result OR press Enter on highlighted: navigate via Next.js `<Link>`.
   - Esc: close modal.
   - Up/Down arrow: navigate results.
   - Highlight matched substrings in result rows.

3. Mount in dashboard layout:
   - Single instance, mounted once for the entire authenticated section.
   - Loads the search index once on mount.
   - Refreshes the index every 5 min OR on window focus (whichever comes first).
   - Place mount near the existing `<PageHeader>` so it's always available.

4. Visual style: match existing dashboard Tailwind palette (stone darks). Modal dialog ~600px wide, centered, drop shadow. Use `lucide-react` icons (Search, Building2 for client, Calendar for event).

5. Accessibility:
   - Focus trap in modal.
   - Aria-labels on all interactive elements.
   - Esc closes modal AND returns focus to body.
   - Keyboard nav fully usable without mouse.

6. Add hint in the dashboard header showing `⌘K` keyboard shortcut on hover/focus, for discoverability.

ACCEPTANCE:
- Pressing Cmd+K from anywhere in the dashboard opens the palette.
- Typing "lock" matches "Champions League Final – Lock Warehouse" event.
- Typing "4TF" matches all 4thefans events.
- Typing "manc" matches Manchester WC26 events.
- Up/Down + Enter navigates correctly.
- Esc closes.
- Mobile: not a priority but at minimum doesn't break — can be a touch-only "Search" button in the page header that opens the same modal.
- Tests cover the search-index route and the fuzzy match function.
- Build clean. No new lint warnings.

==============================================================================
DEPLOY ORDER
==============================================================================

1. PR-1 (CL Final tier_channel_sales backfill + connector fallback). Apply migration 088 via Supabase MCP before merging. This is the single biggest commercial fix — gets Joe's CL Final revenue right before Monday.
2. PR-2 (Manchester source priority). Standalone, no migration. Independent of PR-3 — ships value even if PR-3 takes longer.
3. PR-3 (Manchester fourthefans tier shape). Builds on PR-2's resolver — once PR-3 lands, the two sources converge. Lower urgency than PR-2 because PR-2 already shows the right number via tier_channel_sales path.
4. PR-4 (Cmd+K). Fully orthogonal — can ship at any point. Aim to merge by end of session.

Use `gh pr merge <N> --auto --squash --delete-branch` for each.

==============================================================================
VERIFICATION + HANDOFF
==============================================================================

After all 4 merge:

1. Apply migration 088 via Supabase MCP.
2. Run the diagnostic SQL from /docs/CURSOR_PROMPT_DATA_FIX_AND_CMDK_2026-05-09.md "Diagnostic state at start of session" — confirm:
   - CL Final venues all show populated tier_channel_sales summing to ~£44,920.
   - Manchester venues show resolved tickets > 1,006.
3. Open /clients/[4tf-id]/dashboard. CL Final venue card shows £44k revenue range. Manchester card shows 1,006+ tickets.
4. Open /clients/[4tf-id]/venues/4TF26-ARSENAL-CL-FL. Per-venue revenue cards (Lock/Outernet/TOCA/Village) sum to £44k.
5. Press Cmd+K from anywhere. Type "lock" → "Lock Warehouse" appears. Click → navigates correctly.
6. Reply with: "All 4 PRs merged + migration 088 applied + verified on dashboard. CL Final revenue: £X / Manchester tickets: Y / Cmd+K: working."

DO NOT MERGE if any of:
- Tests fail
- Build fails  
- Migration 088 fails to apply or returns unexpected row count (expected ~32 rows for the CL Final backfill)
- Any of Bristol / Brighton / Glasgow / Edinburgh dashboards regress (verify all show same numbers as before)
- Cmd+K palette breaks any existing keyboard shortcut

If anything regresses, surface it. Don't work around regressions in this bundle.

DOCS UPDATE:
After merging, append a "Delivery log" section to /docs/CURSOR_PROMPT_DATA_FIX_AND_CMDK_2026-05-09.md listing the PR numbers, migration applied, and any deviations from this spec.
````

---

## Why this works as one bundle

- **PR-1, PR-2, PR-3** all touch the dashboard data resolution path. They share files (`lib/dashboard/`, `lib/ticketing/fourthefans/`) so doing them in one session avoids 3 sequential rebases.
- **PR-4 (Cmd+K)** touches no shared files — pure additive new component + new route + one layout mount. Zero collision risk.
- The migration is small (32 rows), idempotent via NOT EXISTS, and reconstructs from existing tier data (no data loss risk).
- Each PR has explicit acceptance criteria so Cursor can self-verify before merging.

## Why Opus 4.7 over Sonnet 4.6

- The source-priority resolver in PR-2 has 4 fallback edges (snapshot present + zero, snapshot present + non-zero, snapshot missing + tier present, both missing). Sonnet has historically dropped one edge. Opus reads them all in one pass.
- The connector parser fix in PR-3 requires reading raw API output and inferring tier-shape variants. Pattern recognition over fuzzy data — Opus territory.
- PR-4's command palette has multiple keyboard / focus / accessibility paths. Opus handles the full path-completeness; Sonnet ships 80% and you find the missing 20% in production.

Net: ~2x token cost, 3-4x fewer iterations. Cheaper end-to-end.

## When to split

If you want lower per-session cost and don't mind two sessions:

**Session A (Opus 4.7) — PR-1 + PR-2 + PR-3.** Data path. Worth the Opus premium.
**Session B (Sonnet 4.6) — PR-4 only.** Cmd+K is mechanical. Sonnet handles fine.

Cost roughly the same. Splitting saves wall-clock if you supervise both. If you're going to drop and walk, single Opus run is the call.

## Stage 2 perf push (PR-G + PR-H) status

Holding for now. Today's data fix takes priority because it's the Joe-Monday risk. Stage 2 still queued for mid-week pending Vercel timing data.

## Drop into Cursor when

Sunday morning is ideal. The migration is small enough that even if you walk away mid-session, the existing fix points are self-contained. Migration 088 + PR-1 alone (the CL Final backfill) takes maybe 30 minutes — that's the must-ship piece. Everything else can slip a day.

Want me to also draft a 2-line "what I'd say to Joe Monday morning if he asks why CL Final revenue went from £102k to £44k" while we're on it? Quick to write, useful to have ready.

## Delivery log

- PR-1: [#367](https://github.com/matas-offpixel/meta-campaign-builder/pull/367) `fix(ticketing): backfill CL Final 4TF channel sales`
- PR-2: [#368](https://github.com/matas-offpixel/meta-campaign-builder/pull/368) `fix(dashboard): prefer fuller tier-channel ticket totals`
- PR-3: [#369](https://github.com/matas-offpixel/meta-campaign-builder/pull/369) `fix(ticketing): parse grouped fourthefans tiers`
- PR-4: [#370](https://github.com/matas-offpixel/meta-campaign-builder/pull/370) `feat(dashboard): add global command search`
- Follow-up: [#371](https://github.com/matas-offpixel/meta-campaign-builder/pull/371) `fix(dashboard): use client primary type in search index`

Migration 088 was applied as an idempotent insert-only CL Final backfill. Live verification after merge showed 31 inserted/present `4TF` channel rows across the 4 CL Final London venues, summing to 2,612 tickets and £44,920 revenue.

Manchester WC26 live verification after merge showed tier-channel totals of 1,006 tickets and £9,201 revenue. The resolver now picks 1,006 tickets over the 699-ticket latest snapshot aggregate.

Deviations from spec: Supabase MCP was unavailable in this runner, so migration 088 was applied via the repo's service-role Supabase path instead of MCP. The expected "~32 rows" resolved to 31 positive tiers in live data; the revenue matched the £44,920 target exactly. PR-3 live raw-payload verification was blocked by missing local fourthefans token decryption material, so parser coverage shipped against nested-shape fixtures. PR-4 required follow-up PR #371 because the live schema column is `clients.primary_type`, not `clients.type`.