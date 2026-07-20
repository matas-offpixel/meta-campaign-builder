# Dashboard performance sprint — 3-day execution plan

**Date:** 2026-06-29
**Budget:** ~30% of Cursor monthly credits, expiring in 3 days
**Owner:** Matas, executing in Cursor Opus
**Status:** Plan + per-PR prompts ready to paste

---

## Why this matters now (the honest framing)

The 2026-05-08 strategic reflection identified the dashboard latency root cause precisely. The Ring-1 bundle shipped that same evening (PRs #360–#365, ~6 hrs Cursor work). **Ring 2 (snapshot-first pattern for internal dashboard, the biggest single win) never shipped.** Six weeks later the 2026-06-18 reflection openly acknowledged the gap and parked it as task #31.

Today's symptoms — 10+ second loads, asset queue not loading, "feels too clunky for me and for the clients" — are exactly what Ring 2 was supposed to fix. We can no longer defer it. This sprint is Ring 2, executed properly in the credit window we have.

Two audits confirmed the diagnosis:

1. **`lib/db/client-portal-server.ts` lines 860–970** has an **N+1 query loop** over brand_campaign events fetching Mailchimp audience snapshots one-by-one. On 4thefans (15–20 brand campaign events) this is 15–20 sequential round-trips after the main parallel batch completes. **500ms–1.2s of unnecessary latency on every page load.**
2. **`/clients/[id]/page.tsx` line 143** has `event_ticketing_links` sequentially queried after the main Promise.all instead of inside it. **80–120ms.**
3. **`loadClientCampaignsData` invokes `loadClientPortalByClientId` redundantly** when the parent page has already loaded it. **1.5–3.5s of duplicated work on tab switch.**
4. **No snapshot-cache pattern on the client portal** equivalent to what PR #87 did for share reports (which took those from 10-30s → <1s).
5. **No `loading.tsx` or Suspense streaming** — the page blocks on the full Promise.all before any markup renders.

Combined floor: **2–5.5 seconds saved on cold load** for 4thefans-scale clients. With snapshot caching: **closer to <1s** for the most-visited paths.

---

## The plan — three PRs in priority order

This is sized to fit your Cursor credit budget while front-loading the highest-ROI wins. Each PR is independent so you can stop after any of them and still have shipped a real improvement.

### PR 1 — Quick wins (4 PR-hours, Sonnet)

The audit found three concrete bottlenecks in the current waterfall. Fix them first. Independent of architecture — no new migrations, no new caches.

- Batch the brand_campaign Mailchimp audience snapshot loop (eliminate N+1).
- Hoist `event_ticketing_links` into the main Promise.all.
- Dedup `loadClientPortalByClientId` invocation between page + campaigns-loader.

**Expected impact: 2–5.5s saved on cold load** for 4thefans + any client with >10 brand_campaign events. Ironworks will benefit too (8 brand_campaign-shaped events including IRWOHD always-on).

Sonnet is the right model — these are mechanical refactors with clear scope.

### PR 2 — Snapshot cache for client portal (Opus, ~6 hours Opus time)

This is the big one. Apply the PR #87 share-report snapshot pattern to the internal client portal. Three layers:

1. New table `client_portal_snapshots` keyed by `(client_id, build_version)`. Stores the full `ClientPortalData` payload as JSONB.
2. New cron `/api/cron/refresh-client-portal-snapshots` runs every 15 minutes (faster than active-creatives because clients are more variable).
3. Reader on `/clients/[id]/page.tsx` checks snapshot first, falls back to live load only on miss, marks stale via `is_stale` flag for stale-while-revalidate.

**Expected impact: <1s cold load** for any client portal that has been visited once in the last 15 minutes. Matches the share-report perf profile.

Opus is correct here — it's a new primitive that touches schema + cron + read path + invalidation. Not a refactor.

### PR 3 — Streaming + Suspense islands (3 PR-hours, Sonnet)

Add `loading.tsx` to `/clients/[id]/` route and break the page into Suspense boundaries so the shell renders immediately and tabs/panels stream in. This is what the 2026-05-08 Ring 1 named as PR-B but wasn't fully landed.

Even with PR 2 making the data load fast, the initial HTML response should never block on the full payload. The user should see the layout in <300ms regardless.

**Expected impact: perceived performance** — users see the page instantly even when DB is cold.

---

## What NOT to do in this sprint

- **No TanStack Query / React Query migration.** That's Ring 3. Cursor will be tempted to suggest it. Refuse.
- **No moving to edge runtime.** Compatibility risk vs reward isn't right for a 3-day window.
- **No new client-portal features.** Pure perf work. If Cursor suggests "while we're here, let's also...", refuse.
- **No touching the asset queue load path itself.** That's likely a separate issue (probably a Dropbox API slow path or render volume). Confirm separately with Network tab. Do NOT bundle into this sprint.
- **No data-model refactor of `ticket_sales_snapshots`.** That's the parked 6-12mo item from the P0 outage. Out of scope.

---

## Three Cursor prompts — paste-ready

### PR 1 prompt — `[Cursor, Sonnet]`

Branch: `cursor/perf/portal-waterfall-fixes`

Paste this in Cursor:

```
GOAL
Three independent quick-wins on the client portal load path. Target: 2-5.5s reduction in cold load on 4thefans-scale clients with no architectural change.

GROUNDING (DO NOT INVENT)
- Audit identified three concrete bottlenecks in lib/db/client-portal-server.ts and app/(dashboard)/clients/[id]/page.tsx.
- All three fixes are mechanical refactors. No new tables, no new caches, no new env vars.
- Existing parallel-batch pattern: lib/db/client-portal-server.ts lines 770-850 already use Promise.all. Match that pattern for the new batches.

WHAT TO BUILD

1. lib/db/client-portal-server.ts lines 860-970
   - Current: after the main Promise.all, code queries mailchimp_audience_snapshots inside a loop, one query per brand_campaign event (lines 920-970).
   - Fix: collect all taggedEventIds first, then issue ONE service-role query with a single eventId IN (...) filter + ORDER BY (snapshot_at DESC, event_id), then map results back into the per-event structure in memory.
   - Match the existing service-role admin client pattern from the rest of the file (do not introduce a new client).
   - Preserve the existing return shape exactly — downstream consumers should not need changes.

2. app/(dashboard)/clients/[id]/page.tsx around line 143
   - Current: after the main Promise.all at line 90, event_ticketing_links is queried sequentially when eventIds.length > 0.
   - Fix: hoist event_ticketing_links query INTO the main Promise.all batch at line 90. Condition the query on eventIds being non-empty by returning empty array early if eventIds resolves empty (but you'll need to handle the eventIds-dependency: either restructure to compute eventIds first via the listEventsServer result then run a SECOND Promise.all of remaining queries, OR — simpler — leave eventIds-dependent queries in a tightly-scoped second Promise.all of only [event_ticketing_links, anything else that depends on eventIds]).
   - The simpler restructure: first Promise.all = independent queries; second Promise.all = eventIds-dependent queries. Both should still be parallel within themselves.

3. lib/db/campaigns-loader.ts (or wherever loadClientCampaignsData lives)
   - Current: loadClientCampaignsData independently calls loadClientPortalByClientId, even though the parent /clients/[id]/page.tsx has already called it.
   - Fix: accept an optional `portal?: ClientPortalData` parameter. If passed, use it; if not, fall back to loading (preserves backward compatibility for any other caller).
   - Update /clients/[id]/page.tsx to pass the already-loaded portal data to loadClientCampaignsData.
   - DO NOT change the public function signature in a breaking way; the new param is optional.

CONSTRAINTS
- DO NOT add new tables, migrations, env vars, or libraries.
- DO NOT change React server-component / client-component boundaries.
- DO NOT touch the asset queue load path.
- DO NOT introduce TanStack Query, edge runtime, or any new caching primitive.
- DO NOT add new features. Perf-only PR.
- Match existing TypeScript strict mode, ESLint config, and CommonJS/ESM import patterns.

VALIDATION GATE
- npm run build: exit 0.
- npm run lint: clean on touched files.
- Existing tests pass.
- Local dev: load /clients/{4thefans-id} cold (kill .next/cache first), measure with browser DevTools Performance tab. Capture before/after numbers in the PR description.
- The console.time/timeEnd logs already in lib/db/client-portal-server.ts will show the gain — paste before/after timings in the PR description.
- No regression on any existing client portal: 4thefans, Junction 2, Ironworks, Louder, Jackies should all still load correctly.

PR DESCRIPTION must include:
- Before/after console.time durations for loadClientPortalByClientId on 4thefans.
- Manual smoke test confirmation on each of: 4thefans, Junction 2, Ironworks.
- "No regressions" statement after smoke tests.
```

### PR 2 prompt — `[Cursor, Opus]`

Branch: `cursor/perf/client-portal-snapshot-cache`

**Prerequisite: PR 1 merged.** Do not start until PR 1 lands — they touch overlapping files.

Paste this in Cursor:

```
GOAL
Apply the PR #87 share-report snapshot pattern to the internal client portal. Cold-load /clients/[id] should drop from 1.5-3.5s to <1s for any client visited in the last 15 minutes. This is Ring 2 from STRATEGIC_REFLECTION_2026-05-08.md, finally being shipped.

GROUNDING (DO NOT INVENT)
- PR #87 (active_creatives_snapshots) is the architectural template. Read lib/reporting/active-creatives-refresh-runner.ts and app/api/cron/refresh-active-creatives/route.ts to understand the pattern.
- Snapshot cache key includes build_version (see migration 067_snapshot_build_version.sql) for deploy invalidation. Match that pattern.
- The data being cached: `ClientPortalData` returned by loadClientPortalByClientId in lib/db/client-portal-server.ts.
- ALL clients in the system are the target (4thefans, Junction 2, Ironworks, Louder, Jackies, etc.) — design for the full client list.
- IMPORTANT: this is internal-dashboard, NOT share-token. RLS scoping is on user_id, not share_token. Use the service-role pattern from PR #87 carefully.

WHAT TO BUILD

1. supabase/migrations/{next_integer}_client_portal_snapshots.sql
   - Before authoring: run `ls supabase/migrations/ | tail -1` and claim the NEXT integer (currently 119 per CLAUDE.md, so likely 120 or whatever's next).
   - Table: client_portal_snapshots
     - id uuid PRIMARY KEY DEFAULT uuid_generate_v4()
     - client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE
     - build_version text NOT NULL (matches existing active_creatives_snapshots pattern from mig 067)
     - payload_jsonb jsonb NOT NULL (stores full ClientPortalData)
     - is_stale boolean NOT NULL DEFAULT false
     - refreshed_at timestamptz NOT NULL DEFAULT now()
     - created_at timestamptz NOT NULL DEFAULT now()
     - UNIQUE (client_id, build_version) with NULLS NOT DISTINCT
   - Index: (client_id, refreshed_at DESC)
   - RLS: enable, but writers are service-role only; readers are anyone with access to clients table for that client_id (mirror existing client_report_weekly_snapshots RLS shape — go read it).

2. lib/reporting/client-portal-snapshot.ts (NEW)
   - export `readClientPortalSnapshot(clientId: string): Promise<ClientPortalData | null>`
   - export `writeClientPortalSnapshot(clientId: string, payload: ClientPortalData): Promise<void>` — service-role only
   - Pattern: read latest where client_id = ? AND build_version = VERCEL_GIT_COMMIT_SHA, return null if stale (>15min) OR missing.
   - Respect feedback_screenshot_falsification_requires_payload_trace memory and the snapshot write contract rule from CLAUDE.md ("writeActiveCreativesSnapshot refuses on kind: skip|error to preserve last-good").

3. lib/reporting/client-portal-snapshot-runner.ts (NEW)
   - export `refreshAllClientPortalSnapshots()`: enumerate active clients, call loadClientPortalByClientId for each, writeClientPortalSnapshot.
   - Process clients SEQUENTIALLY (NOT in parallel) to avoid the burstable-compute-cascade pattern from the 2026-06-29 P0 incident. Memory: feedback_supabase_burstable_compute_cascade.
   - Per-client timeout: 30s. Log+skip on timeout, do NOT propagate.
   - Output structured console.error log lines (NOT console.log/warn per feedback_vercel_log_filtering_console_error_only).

4. app/api/cron/refresh-client-portal-snapshots/route.ts (NEW)
   - GET handler. Auth: cron secret pattern (match how /api/cron/refresh-active-creatives does it — go read that file).
   - Add to vercel.json cron config: schedule "*/15 * * * *" (every 15 minutes).
   - maxDuration = 300 (5 min ceiling; client iteration should finish in ~2 min for current client count).

5. app/(dashboard)/clients/[id]/page.tsx
   - At the top of the page server component, BEFORE the main Promise.all:
     - Call `readClientPortalSnapshot(id)`.
     - If returns non-null fresh snapshot: skip the existing Promise.all of portal-related queries, use the snapshot's data.
     - If null/stale: run the existing Promise.all live (current path) AND fire a background refresh (don't await — fire and forget).
   - DO NOT remove the existing Promise.all live path. It's the fallback.

6. lib/db/client-portal-server.ts
   - Add `force?: boolean` optional flag to loadClientPortalByClientId to bypass snapshot read (for cron + admin debug routes).

7. Add an admin-debug page or extend the existing admin tooling to manually trigger refreshAllClientPortalSnapshots once and inspect snapshot freshness. Minimal UI — internal only.

CONSTRAINTS
- DO NOT change the public shape of ClientPortalData. The snapshot stores the existing payload type.
- DO NOT bypass the existing live-load path entirely. Snapshot is a layer; live is the fallback.
- DO NOT remove the console.time/timeEnd logs in client-portal-server.ts. Useful for verifying the snapshot path is actually being hit.
- DO NOT introduce a new caching library (Redis, KV). Supabase is the cache.
- Match the existing migrations format. Run `ls supabase/migrations/ | tail -1` BEFORE authoring to claim the right integer.
- Use console.error for all production-diagnostic logs in the cron + runner (memory: feedback_vercel_log_filtering_console_error_only).
- The cron writer must process clients sequentially, not in parallel, to avoid CPU-credit cascade (memory: feedback_supabase_burstable_compute_cascade).

VALIDATION GATE
- npm run build: exit 0. npm run lint: clean.
- Apply the migration via supabase mcp (apply_migration, not execute_sql).
- Trigger the cron manually from the admin debug page. Verify snapshot rows appear in client_portal_snapshots.
- Cold-load /clients/{4thefans-id}: before snapshot exists = uses live path; after snapshot exists + within 15min = uses snapshot path.
- Measure with browser DevTools: cold load via snapshot path should be <1s pre-render latency vs 1.5-3.5s for live path.
- Smoke test ALL active clients still load correctly: 4thefans, Junction 2, Ironworks, Louder, Jackies. No regression.
- Verify the build_version invalidation works: deploy a no-op change, confirm old snapshots are bypassed on next request.

PR DESCRIPTION must include:
- Before/after timings (live path vs snapshot path) on 4thefans.
- Smoke test confirmation for all active clients.
- Snapshot row counts after one cron tick.
- Confirmation that build_version invalidation works.
- Notes on any clients that errored during snapshot population.
```

### PR 3 prompt — `[Cursor, Sonnet]`

Branch: `cursor/perf/portal-suspense-streaming`

**Prerequisite: PR 2 merged.**

Paste this in Cursor:

```
GOAL
Make the /clients/[id] page render its shell immediately (<300ms) and stream tab content as it loads. Even with snapshot caching from PR 2, the user should see the layout instantly while data fills in.

GROUNDING
- Next.js 16 streaming + Suspense pattern. The shell should be a server component that renders synchronously; data-heavy tabs (campaigns, asset-queue, ticketing-import) should be Suspense-wrapped async server components.
- 2026-05-08 reflection PR-B was supposed to do this. It didn't fully land.
- The page is already RSC. The work is adding `loading.tsx` and breaking Promise.all-heavy parts into Suspense boundaries.

WHAT TO BUILD

1. app/(dashboard)/clients/[id]/loading.tsx (NEW if missing)
   - Skeleton matching the actual page layout: header, tab bar, primary panel area.
   - Use existing shadcn/ui Skeleton component or match the existing skeleton patterns in the repo (grep for "Skeleton" in components/).

2. app/(dashboard)/clients/[id]/page.tsx
   - Split the page into:
     - Synchronous shell: header, client name, tab bar (data already in snapshot or in the initial portal load, very fast).
     - Async sub-components wrapped in <Suspense fallback={<Skeleton/>}> for the heaviest tabs: campaigns tab, asset queue tab, ticketing-import tab.
   - The shell should never block on the heaviest queries.

3. Identify the 2-3 heaviest data fetches in the page and move them INTO their async sub-component (not done at the top-level page).

CONSTRAINTS
- DO NOT remove the snapshot-cache path from PR 2. This is purely about render streaming on top of fast data.
- DO NOT change tab routing logic.
- DO NOT introduce client-side data fetching (no useEffect+fetch). Still RSC, just streamed.
- Match existing component layout exactly — no visual regressions.

VALIDATION GATE
- npm run build / lint clean.
- Throttle network to "Slow 3G" in DevTools, navigate to /clients/{id}. Confirm the page shell renders in <300ms even though the data takes longer.
- All tabs still render correctly with their data when the Suspense resolves.
- No visual regression vs before — same layout, just streamed.

PR DESCRIPTION must include:
- Network-throttled screen recording or screenshots showing the shell appearing before content.
- Confirmation that all tab content still renders correctly post-Suspense.
```

---

## Sequence + risk management

1. **Merge PR 1 first.** Lowest risk, biggest immediate win for non-snapshot-cache benefit. Quick to verify.
2. **Wait ~90s between PR merges** (memory: deploy-race rule).
3. **Then PR 2.** Apply migration via `mcp__supabase__apply_migration`, NOT `execute_sql` (memory: `feedback_migration_workflow_discipline`).
4. **Smoke test PR 2 extensively before PR 3.** New cron + new table + new read path = real risk surface.
5. **PR 3 last** because it depends on PR 2 making the underlying data fast.

**If credits run out before PR 3:** that's fine. PRs 1 + 2 deliver 90% of the win. PR 3 is the polish.

**If PR 2 hits an issue:** stop. Don't ship a half-working snapshot cache. The legacy live-load path is fully preserved as fallback, so even if the cache misfires, behaviour stays correct, just slow.

---

## Verification metric

Before starting, capture the cold-load timing for 4thefans dashboard from your local dev machine: kill `.next/cache`, navigate to `/clients/{4thefans-id}`, capture the `loadClientPortalByClientId` console.time output. That's your baseline.

After all three PRs ship, repeat on Vercel Production. Target: **first-paint <1s on a warm snapshot, full data render <2s.** Anything worse and we re-open the audit.

---

## Memory updates after this sprint

If the wins land, save:
- `project_perf_dashboard_snapshot_pattern_shipped_2026-06-29.md` — measured before/after timings, what shipped, the parallel-to-PR-#87 architecture
- `feedback_snapshot_pattern_template_for_portal_routes.md` — generalised template for applying snapshot-cache to any read-heavy server-component page

Update the 2026-06-18 reflection's "Acknowledged-but-deferred" section to mark Ring 2 as shipped.

---

## What the team learned to NOT repeat

From the audit history: **the 2026-05-08 reflection got Ring 1 right and then deferred Ring 2 for six weeks.** The pattern was: identify the problem precisely, ship the quick fixes the same evening, then drift onto more interesting work. Ring 2 was the actual leverage and it never happened until users complained.

The lesson for next time: **when a strategic reflection identifies a "biggest single win" item, it gets a calendar deadline in the same document, not a "to be revisited" footnote.** The 2026-06-18 reflection's structural surfaces (Surface 2 D2C scheduler, Surface 3 ops panel) need that discipline too — set a date now, ship by that date.
