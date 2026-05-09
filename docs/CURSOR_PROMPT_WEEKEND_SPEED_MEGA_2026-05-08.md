# Cursor Mega Prompt — Weekend Speed Push 2026-05-08

**Recommended model: Opus 4.7.** Reasoning: this is one bundle that touches 6 domains (auth flow not affected), introduces 1 migration, restructures a load-bearing loader, and changes vercel.json cron schedules. Sonnet 4.6 will work but will require 2-3 rebases when it under-handles edge cases (we've seen this pattern with the audience-builder probe arc). Opus closes it in one shot.

**Estimated Cursor runtime:** 90-120 min. ~$8-12 of API spend.

**Reasoning for combining:** All 6 PRs touch independent files (loader, page files, suspense components, vercel.json, audience cache route, new migration). Zero merge conflicts. One PR queue saves rebase cost vs 6 separate sessions.

---

## Copy block — paste this entire block into Cursor as one prompt

````
You are landing 6 independent perf PRs in one bundle for Off/Pixel's internal dashboard + Meta-touching surfaces. Strategic context lives in `/docs/STRATEGIC_REFLECTION_2026-05-08.md` and `/docs/META_API_BOTTLENECKS_2026-05-08.md`. Read those two files FIRST before touching code so you understand why each fix is shaped the way it is.

==============================================================================
NON-NEGOTIABLES (do not violate any of these — they are load-bearing)
==============================================================================

1. Do NOT collapse the two Meta retry policies in `lib/meta/client.ts` (transient vs rate-limit). They are intentionally different.
2. Do NOT raise `CREATIVE_BATCH_SIZE` above 25 or `AD_INSIGHT_CHUNK_CONCURRENCY` above 1.
3. Do NOT bypass the snapshot write contract — `writeActiveCreativesSnapshot` and `writeShareSnapshot` refuse on `kind: "skip" | "error"`.
4. Do NOT rename `proxy.ts` (Next.js 16's middleware name).
5. Every new PR opens off fresh `main`. Never push follow-up commits to a merged branch.
6. Branch protection is OFF currently — do not commit directly to `main`. Always use a feature branch + PR + `gh pr merge --auto --squash --delete-branch`.
7. Service-role client (`createServiceRoleClient()`) for any read of `active_creatives_snapshots`, `share_insight_snapshots`, or future snapshot tables. NEVER user-scoped Supabase client for those reads.
8. Every snapshot table needs a `build_version` column stamped with `process.env.VERCEL_GIT_COMMIT_SHA`. Readers treat mismatched/NULL as stale.

==============================================================================
PR-A — perf/client-portal-loader-parallelise
==============================================================================

GOAL: Convert `loadPortalForClientId` in `lib/db/client-portal-server.ts` from a sequential 10-RT waterfall into a parallelised loader. Target: 1500ms → 400ms cold loader on 42-event clients.

WHERE: `lib/db/client-portal-server.ts`, function `loadPortalForClientId` (around line 526).

CURRENT SHAPE (sequential awaits):
- clients lookup → events → snapshots → daily entries → daily rollups → ticketing status → ticket tiers → additional tickets → tier channels → tier channel allocations → tier channel sales → ticket sales snapshots
- Steps 3-12 only depend on `eventIds`. They are all independent of each other.

CHANGES:
1. Keep steps 1 (clients) and 2 (events) sequential — step 2 produces `eventIds`.
2. Wrap steps 3-12 in `Promise.all` once `eventIds` is computed:
   ```ts
   const [
     snapshotsRaw,
     dailyEntries,
     dailyRollups,
     ticketingStatusByEvent,
     ticketTiers,
     additionalTickets,
     tierChannels,
     tierChannelAllocations,
     tierChannelSales,
     ticketSnapshotRows,
   ] = await Promise.all([
     eventIds.length > 0 ? admin.from("client_report_weekly_snapshots")...select(...) : Promise.resolve({ data: [] as ... }),
     fetchAllDailyEntries(admin, clientId),
     eventIds.length > 0 ? fetchAllDailyRollups(admin, eventIds) : Promise.resolve([]),
     eventIds.length > 0 ? fetchTicketingStatusByEvent(admin, eventIds) : Promise.resolve(new Map()),
     listEventTicketTiersForEvents(admin, eventIds),
     eventIds.length > 0 ? fetchAllAdditionalTickets(admin, eventIds) : Promise.resolve([]),
     listChannelsForClient(admin, clientId),
     eventIds.length > 0 ? listAllocationsForEvents(admin, eventIds) : Promise.resolve([]),
     eventIds.length > 0 ? listSalesForEvents(admin, eventIds) : Promise.resolve([]),
     eventIds.length > 0 ? fetchAllTicketSalesSnapshots(admin, eventIds) : Promise.resolve(null),
   ]);
   ```
3. Re-thread the existing post-processing logic (snapshot grouping, additional-ticket totals, weekly snapshot collapse) onto the now-resolved arrays. KEEP every single piece of post-processing logic; only the awaiting changes.
4. Add `if (process.env.NODE_ENV !== "production") { console.time(...) / timeEnd(...) }` blocks around (a) the parallel fetch and (b) the entire function so we can baseline+verify in dev.
5. Type guard: ensure `ticketSnapshotRows` null branch falls through to the existing `if (rows)` shape.

ACCEPTANCE:
- All 797 existing tests still pass.
- Add unit test in `lib/db/__tests__/client-portal-server-parallel.test.ts` that mocks 10 round-trips, asserts `Promise.all` is used (i.e. total wall time < sum of individual times) — use `vi.useFakeTimers` if helpful.
- npm run build clean. tsc clean.
- Run `console.time` log on dev and confirm <500ms cold for 4thefans (clientId from `clients.slug = "4thefans"`).

==============================================================================
PR-B — perf/loading-suspense-boundaries
==============================================================================

GOAL: Eliminate the blank-screen wait on three pages by streaming the shell first.

WHERE:
- `app/(dashboard)/clients/[id]/dashboard/page.tsx`
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`
- `app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx`

CHANGES:
1. Create a co-located `loading.tsx` file alongside each `page.tsx` above. Skeleton it with:
   - PageHeader-shaped div (h-16 bg-stone-900 animate-pulse) + breadcrumb stub
   - Sticky tab row (h-10 bg-stone-900 animate-pulse w-full)
   - 6-cell stats grid skeleton (grid-cols-3 lg:grid-cols-6, each cell `h-24 bg-stone-900 animate-pulse rounded`)
   - Single full-width chart skeleton (`h-72 bg-stone-900 animate-pulse rounded`)
   - Match existing dashboard styling (Tailwind v4 stone palette).
2. In each page.tsx, wrap heavy children in `<Suspense fallback={<...skeleton>}>`:
   - Active Creatives section (any component containing `<ShareActiveCreativesSection>` or `<VenueActiveCreatives>`)
   - Daily Tracker (`<VenuePaidMediaDailyTracker>` etc.)
   - Patterns tile grid
3. The Suspense boundaries should be at the level of the bulky child component, NOT around the entire page tree. The shell + topline numbers must paint immediately.
4. Each Suspense fallback gets its own dedicated skeleton component in `components/dashboard/skeletons/`. Reuse Tailwind `animate-pulse` consistently.

ACCEPTANCE:
- Manually load `/clients/<id>/dashboard` and confirm the shell paints within 200ms (visual; Cursor uses Vercel preview deploy).
- Lighthouse perf score on preview deploy improves by ≥10 points vs main.
- No layout shift (CLS < 0.05) when content swaps in.
- All tests pass. Build clean.

==============================================================================
PR-C — perf/venue-page-narrow-loader
==============================================================================

GOAL: Stop the venue page from loading the entire client portal payload then filtering. Replace with a venue-scoped query path that filters at SQL.

WHERE: `lib/db/client-portal-server.ts` (add new function), `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` (swap caller).

CHANGES:
1. Add a new exported function `loadVenuePortalByCode(clientId: string, eventCode: string): Promise<ClientPortalData>` to `client-portal-server.ts`.
2. The new function MUST share the same return shape as `loadClientPortalByClientId` so the existing `<VenueFullReport>` component renders unchanged.
3. Internally:
   - Step 1: clients lookup as today.
   - Step 2: events filtered by `eq("client_id", clientId).eq("event_code", eventCode)` — typically 1-4 rows for multi-venue events like CL Final.
   - Steps 3-12: same as `loadPortalForClientId` but `eventIds` is the narrow set (1-4 instead of 42). Use the same `Promise.all` shape from PR-A.
   - Tier-channel + allocation + sales reads must still go through the per-event filters.
   - Channels are per-client → keep that branch as-is.
4. In the venue page, replace `loadClientPortalByClientId(id)` with `loadVenuePortalByCode(id, eventCode)`. Drop the in-memory `result.events.filter(...)` step that follows — the loader already filtered.
5. KEEP `loadClientPortalByClientId` for the dashboard route. Don't refactor it away.

ACCEPTANCE:
- Venue page cold load drops to <300ms (verify with Vercel Analytics or `console.time`).
- Existing venue-page tests all pass.
- Lock Warehouse / TOCA Social / Outernet pages render identically to before.
- Trend chart, Active Creatives, Funnel Pacing all render with full data.
- Build clean.

==============================================================================
PR-D — perf/audience-builder-maxduration-and-precache
==============================================================================

GOAL: Eliminate the Audience Builder video-views timeout. Replace module-level Map cache with DB-backed table that survives serverless cold start. Pre-warm top-3 most-recent campaigns when Builder opens.

WHERE: 
- New migration `supabase/migrations/080_audience_source_cache.sql`
- New module `lib/audiences/source-cache-db.ts`
- Modify `app/api/audiences/sources/campaign-videos/route.ts`
- Modify `app/api/audiences/sources/multi-campaign-videos/route.ts`
- Add new route `app/api/audiences/sources/prewarm/route.ts`
- Modify Audience Builder UI: find the entry component (probably `components/audiences/audience-builder-shell.tsx` or similar — grep for "audience" first)

CHANGES:

1. Migration 080 — `audience_source_cache`:
   ```sql
   CREATE TABLE IF NOT EXISTS audience_source_cache (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
     client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
     source_kind TEXT NOT NULL CHECK (source_kind IN ('campaign-videos', 'multi-campaign-videos', 'campaigns', 'pages', 'pixels')),
     cache_key TEXT NOT NULL,
     payload JSONB NOT NULL,
     payload_size_bytes INTEGER GENERATED ALWAYS AS (octet_length(payload::text)) STORED,
     fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     expires_at TIMESTAMPTZ NOT NULL,
     build_version TEXT,
     UNIQUE (user_id, client_id, source_kind, cache_key)
   );
   CREATE INDEX idx_audience_source_cache_lookup ON audience_source_cache (user_id, client_id, source_kind, cache_key, expires_at);
   ALTER TABLE audience_source_cache ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "owner read" ON audience_source_cache FOR SELECT USING (auth.uid() = user_id);
   -- writes are service-role only via the cache helper
   ```

2. New `lib/audiences/source-cache-db.ts`:
   - Exports `getCachedAudienceSourceDb<T>(args: { userId, clientId, sourceKind, cacheKey, ttlMs, load: () => Promise<T> }): Promise<T>`
   - Reads via service-role client (cache lookup must bypass RLS for fast read).
   - On miss: calls `load()`, persists payload + expires_at = now + ttlMs + build_version stamp.
   - On hit (expires_at > now AND build_version matches current VERCEL_GIT_COMMIT_SHA): return payload.
   - On stale (build_version mismatch): treat as miss, re-fetch.
   - Skips writes for empty payloads (`payload.videos?.length === 0` etc.) — same as current `audienceSourcePayloadIsCacheable` check.

3. Update `app/api/audiences/sources/campaign-videos/route.ts`:
   ```ts
   export const maxDuration = 60; // ADD THIS LINE AT TOP OF FILE
   ```
   And replace `getCachedAudienceSource(...)` call with `getCachedAudienceSourceDb({ userId: user.id, clientId, sourceKind: "campaign-videos", cacheKey: campaignId, ttlMs: 30 * 60 * 1000, load: () => fetchAudienceCampaignVideos(...) })`.

4. Same `maxDuration = 60` + DB cache swap on `app/api/audiences/sources/multi-campaign-videos/route.ts`.

5. New route `app/api/audiences/sources/prewarm/route.ts`:
   - POST. Body: `{ clientId: string }`.
   - Auth: regular user session.
   - Resolves the client's ad account, fetches the 3 most-recent campaigns from `events` (or via Meta `campaign` listing call — pick whichever is faster — preferred is `event_daily_rollups` distinct campaign IDs sorted by max date).
   - For each, fires a `fetchAudienceCampaignVideos` call asynchronously through the DB cache.
   - Returns `{ ok: true, prewarmed: 3 }` immediately (don't await the fetches; let them populate cache in background using `waitUntil` if available, otherwise fire-and-forget).

6. UI: locate the Audience Builder entry (grep for "Audience Builder" in components/). On client load, fire `POST /api/audiences/sources/prewarm` (don't block UI on response).

7. Keep the old `lib/audiences/source-cache.ts` Map-cache as a no-op shim for any tests that import it, but mark it `@deprecated` — flip all callers to the DB version.

ACCEPTANCE:
- Apply migration via Supabase MCP before merging.
- Cold-load Audience Builder for 4thefans → click "Video Views (75%)" on a J2-scale campaign → returns within 30s, no timeout error.
- Second user / second cold-start hits cache (verify by checking `audience_source_cache` table after first fetch).
- Existing audience-builder tests pass.

==============================================================================
PR-E — perf/cron-cadence-reduction
==============================================================================

GOAL: Drop refresh-active-creatives + refresh-creative-insights + rollup-sync-events from 5×/day to 3×/day for non-show-week events. Show-week events (event_date within 7 days) keep 5×/day cadence via in-runner branch.

WHERE: `vercel.json` + `lib/dashboard/cron-eligibility.ts` (or wherever the eligibility runner lives — grep for "loadActiveCreativesCronEligibility").

CHANGES:

1. `vercel.json` — change the schedules:
   ```json
   { "path": "/api/cron/refresh-creative-insights", "schedule": "10 6,12,18 * * *" },
   { "path": "/api/cron/rollup-sync-events",        "schedule": "15 6,12,18 * * *" },
   { "path": "/api/cron/refresh-active-creatives",  "schedule": "30 6,12,18 * * *" },
   ```
   Keep sync-ticketing and tiktok crons at 5×/day for now — they're cheaper and ticket data is the live signal.

2. NEW: a "show-week burst" cron that runs only for show-week events at 5×/day. Add to `vercel.json`:
   ```json
   { "path": "/api/cron/show-week-burst", "schedule": "20 8,14,20 * * *" }
   ```
   That's 3 extra runs per day on top of the 3 base runs = effectively 5-6×/day for events within event_date - 7d.

3. Build `app/api/cron/show-week-burst/route.ts`:
   - Bearer auth like other crons.
   - Eligibility query: events where `event_date` between `now()` and `now() + interval '7 days'` AND has either ticketing connection OR campaign signal.
   - For each, calls the same internal handlers as refresh-active-creatives + rollup-sync-events for that single event.
   - Re-uses `runRollupSyncForEvent` and `refreshActiveCreativesForEvent` directly — no fetch.

4. Add a `cadence_tier` field to the cron summary log output: "base" (3×) vs "burst" (5×) so we can grep usage.

ACCEPTANCE:
- Vercel Cron settings page reflects the new schedule after deploy.
- `show-week-burst` runs only iterates events within 7-day window (verify with a manual `curl` of the route after deploy on a non-show-week test).
- Total Meta API calls/day per ad-account drops by ~30-40% (verify after 2 days running new schedule).
- All ticket-sale-day events still get fresh data within 4-hour windows.

==============================================================================
PR-F — perf/cron-stagger-extension
==============================================================================

GOAL: Stretch the Meta cron stagger from 30-min window to 90-min window so cron Meta-call density per hour drops by ~3x.

WHERE: `vercel.json`.

CHANGES:

After PR-E lands, the schedule looks like:
```
sync-ticketing            06,10,14,18,22  (5×, base + show-week, ticketing only)
refresh-creative-insights 10 6,12,18      (3×)
rollup-sync-events        15 6,12,18      (3×)
refresh-active-creatives  30 6,12,18      (3×)
show-week-burst           20 8,14,20      (3×)
```

Stretch the Meta-only crons to 90-min window per cycle:
```
sync-ticketing            00 6,10,14,18,22
refresh-creative-insights 30 6,12,18
rollup-sync-events        00 7,13,19      (next hour, +30 from insights)
refresh-active-creatives  30 7,13,19      (+30 from rollup-sync)
show-week-burst           00 9,15,21      (separate hour from base burst)
```

Result: any single ad-account never has more than 1 cron firing within a 30-minute window. Eases Meta hourly budget pressure.

ACCEPTANCE:
- Vercel Cron page reflects new times.
- Sanity-check: in any 30-min period, at most one Meta cron fires per ad-account.
- Cron logs continue to show `all_ok=true` for at least 24h post-deploy.

==============================================================================
DEPLOY ORDER
==============================================================================

Open all 6 PRs against fresh branches off `main`. Merge in this order to avoid rebases:

1. PR-A (loader parallelisation) — independent file, safe first.
2. PR-C (venue-narrow loader) — depends on PR-A's `Promise.all` shape pattern but on different function.
3. PR-B (Suspense boundaries) — depends on neither, but needs PR-A merged so Suspense islands aren't fronting a slow loader.
4. PR-D (audience cache + maxDuration) — fully independent.
5. PR-E (cron cadence) — vercel.json change. Apply migration 080 before merging if not already.
6. PR-F (cron stagger) — vercel.json change. Merge last.

Use `gh pr merge <N> --auto --squash --delete-branch` for each.

==============================================================================
VERIFICATION + HANDOFF
==============================================================================

After all 6 merge:

1. Apply migration 080 via Supabase MCP if not already applied.
2. Verify Vercel deploys all green.
3. Capture before/after timing in Vercel Analytics for: client dashboard load, venue page load, patterns page load, audience builder open, audience video-views fetch.
4. Update `docs/STRATEGIC_REFLECTION_2026-05-08.md` with measured deltas at end of "Action queue" section.
5. Reply with: "All 6 PRs merged + migration 080 applied + Vercel timing deltas: [numbers]". If any PR fails to merge or produces unexpected behaviour, STOP and surface the issue rather than working around it — these are load-bearing changes.

DO NOT MERGE if any of:
- Tests fail
- Build fails
- Migration 080 fails to apply
- Type-check produces new errors
- Lint produces new warnings on the changed files

If you hit a 207 Multi-Status (cron partial fail) post-deploy on a Meta cron, that is acceptable temporarily — it just means an account had transient errors. But if it persists for 6h+, surface it.
````

---

## Why this is one big prompt instead of six small ones

- All 6 PRs touch independent files — zero merge conflicts inside the bundle.
- The retry-policy and snapshot-write contracts are flagged as non-negotiable up front, preventing Cursor from "improving" them mid-PR.
- Cursor's biggest cost is the ramp time per session (re-reading CLAUDE.md, planning files, etc.). 6 sessions = 6x ramp. One session = 1x ramp + 6 PRs.
- Merge order is explicit so it doesn't pause to ask.

## Why Opus 4.7 specifically

- This bundle introduces a new migration, a new route, modifies cron schedule, and restructures a load-bearing loader.
- Sonnet 4.6 will work but historically under-handles the discriminated-union narrowing in the loader's `Promise.all` rewrite (we hit this on PR #246 RLS arc and PR #319 enhancement scan dedupe).
- Opus 4.7 reads the full call graph in one pass and produces the parallel rewrite without losing post-processing logic. That's the failure mode to avoid here.
- Cost delta: ~2x Sonnet cost per token, but ~4-5x fewer iterations needed for this size of restructure. Net cheaper end-to-end.

---

## When to use Sonnet 4.6 instead

If you want to break this into two Cursor sessions (smaller per-session bills, easier to interrupt), split as:

**Session 1 (Sonnet 4.6) — PR-D + PR-E + PR-F.** Audience cache + cron schedule changes. These are mechanical, well-shaped, low-risk. Sonnet is fine.

**Session 2 (Opus 4.7) — PR-A + PR-B + PR-C.** The internal-dashboard loader + suspense boundaries + venue narrow loader. This is the structural restructure where Opus's call-graph awareness pays for itself.

Estimated cost: split ~$3 (Sonnet) + $7 (Opus) = $10. Single Opus run ~$10. Wash on cost; the split saves ~30 min wall-clock if you can supervise both sessions in parallel.

---

## When to use ChatGPT-5.5 (or other)

Don't, for this bundle. Cursor + ChatGPT-5.5 can do it but:
- ChatGPT lacks the real-time Vercel/Supabase MCP integration we lean on for migration 080 application.
- Cursor's GitHub PR loop with Claude is faster end-to-end than the GPT manual diff-paste flow.
- We've seen ChatGPT under-handle the discriminated-union narrowing pattern in TypeScript strict mode (lib/types.ts is unforgiving).

ChatGPT-5.5 is good for: standalone scripts, one-shot SQL, prose work. For this multi-file restructure, stay in Cursor.

---

## Stage 2 Cursor prompt (for next week, NOT this weekend)

The cron parallelism + per-account semaphore PRs (PR-G + PR-H) deserve their own session because:
- They depend on PR-D's DB cache being live.
- They modify the retry-policy edge in `lib/meta/client.ts` — load-bearing per CLAUDE.md.
- They need a 24h soak after PR-A-F to baseline impact.

I'll draft that prompt next week once we see weekend deploy data. Don't bundle it in.
