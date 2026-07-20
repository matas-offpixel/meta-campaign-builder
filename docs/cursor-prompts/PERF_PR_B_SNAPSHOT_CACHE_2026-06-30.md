# PR B — Client portal snapshot cache for sub-1s cold load

**Tag:** `[Cursor, Opus]`
**Branch:** `cursor/perf/client-portal-snapshot-cache`
**Scope target:** ~10-12 files, single PR
**Prereq:** PR #641 + PR #643 merged (both done)

## Why this PR

Matas's complaint: landing on `/clients/{4thefans-id}` still takes 5+ seconds even after PR #641 (waterfall fixes) and PR #643 (hover prefetch). PR A made subsequent navigation faster but didn't address the cold load itself.

The waterfall fixes in PR #641 cut the *concurrent* re-execution of the portal load. PR #643 made *navigation* feel faster via hover prefetch. **Neither addressed the underlying cost of running `loadClientPortalByClientId` once.** That's still ~3-4s of DB work on a shared-CPU instance.

**The snapshot cache is the structural fix.** Same architectural pattern as PR #87 (share-report snapshot cache) which took share reports from 10-30s to <1s. Apply it to the internal client portal. Cold load drops from 5s to <1s on snapshot-warmed paths.

This is the original "PR C" from the 3-PR plan, promoted to PR B because in-client tab switching pain reduces dramatically once the cold load is fast.

## Paste this into Cursor (Opus)

```
GOAL
Apply the PR #87 share-report snapshot cache pattern to the internal client portal. Cold-load /clients/[id] should drop from 5+ seconds to <1 second when a snapshot is warm. 15-minute freshness window. Live-load fallback preserved for cache miss.

GROUNDING (DO NOT INVENT — VERIFIED 2026-06-30)
- The architectural template is PR #87: active_creatives_snapshots. Files to read first:
  * supabase/migrations/067_snapshot_build_version.sql — pattern for build_version invalidation across deploys
  * lib/reporting/active-creatives-refresh-runner.ts — runner pattern (sequential client iteration)
  * app/api/cron/refresh-active-creatives/route.ts — cron auth pattern
- The data being cached: ClientPortalData returned by loadClientPortalByClientId in lib/db/client-portal-server.ts. Read the return type carefully; it's the canonical shape.
- All current clients are the target: 4thefans, Junction 2, Ironworks, Louder, Jackies, plus any other active clients in the clients table.
- IMPORTANT: this is an INTERNAL dashboard surface, NOT a share-token surface. RLS scoping is user_id, not share_token. The snapshot writer must use service-role; readers must respect user-level access via the existing clients RLS.
- CLAUDE.md invariant: writeActiveCreativesSnapshot refuses on kind:skip|error to preserve last-good. Match the same refusal contract for the new snapshot writer.
- Memory: feedback_supabase_burstable_compute_cascade — process clients SEQUENTIALLY in the cron, NOT in parallel. We are on Nano Supabase (500MB RAM); parallel client iteration risks memory pressure.
- Memory: feedback_vercel_log_filtering_console_error_only — use console.error (not console.log/warn) for any production-diagnostic log in the cron + runner.
- CLAUDE.md latest migration: check `ls supabase/migrations/ | tail -1` for the next integer. Claim that integer for the new migration; rebase if another PR took it.

WHAT TO BUILD

1. supabase/migrations/{next}_client_portal_snapshots.sql
   - Before authoring: run `ls supabase/migrations/ | tail -1` to claim the next integer.
   - Table: client_portal_snapshots
     - id uuid PRIMARY KEY DEFAULT uuid_generate_v4()
     - client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE
     - build_version text NOT NULL (matches active_creatives_snapshots mig 067)
     - payload_jsonb jsonb NOT NULL (full ClientPortalData)
     - refreshed_at timestamptz NOT NULL DEFAULT now()
     - created_at timestamptz NOT NULL DEFAULT now()
   - UNIQUE (client_id, build_version)
   - Index: idx_client_portal_snapshots_lookup (client_id, refreshed_at DESC)
   - RLS: enable. SELECT policy: user can read snapshots for clients they own (join via clients.user_id pattern — read existing client_report_weekly_snapshots RLS for the exact shape).
   - INSERT/UPDATE: service-role only (default — no policy needed for writes since service-role bypasses RLS).

2. lib/reporting/client-portal-snapshot.ts (NEW)
   - export `readClientPortalSnapshot(clientId: string, opts?: { maxAgeMs?: number }): Promise<ClientPortalData | null>`
     - Query: latest where client_id = ? AND build_version = VERCEL_GIT_COMMIT_SHA, refreshed_at within maxAgeMs (default 15 * 60 * 1000).
     - Returns null on miss / stale / build_version mismatch — caller falls back to live load.
     - Uses anon-key supabase client (RLS-enforced).
   - export `writeClientPortalSnapshot(clientId: string, payload: ClientPortalData): Promise<void>`
     - SERVICE-ROLE only. Throws if SUPABASE_SERVICE_ROLE_KEY missing.
     - Insert with build_version = VERCEL_GIT_COMMIT_SHA ?? "unknown".
     - On conflict (client_id, build_version): UPDATE payload_jsonb, refreshed_at = now().
   - Match the writer contract from CLAUDE.md: writer must refuse to overwrite a good snapshot with garbage. If payload is null/empty/missing required fields, throw — DO NOT write.

3. lib/reporting/client-portal-snapshot-runner.ts (NEW)
   - export `refreshAllClientPortalSnapshots(): Promise<{ ok: number; failed: string[] }>`
   - Pattern: enumerate active clients via service-role SELECT id FROM clients (no soft-delete filter unless one exists).
   - Iterate SEQUENTIALLY (NOT Promise.all — memory + DB risk on Nano).
   - For each client: call loadClientPortalByClientId(clientId), then writeClientPortalSnapshot.
   - Per-client timeout: 30s. On timeout or throw: console.error log, push client id into failed[], CONTINUE to next client (do not propagate).
   - Use console.error for all production-diagnostic logs.
   - Return { ok: count_succeeded, failed: array_of_client_ids }.

4. app/api/cron/refresh-client-portal-snapshots/route.ts (NEW)
   - GET handler. Auth: match the cron auth pattern of /api/cron/refresh-active-creatives (read that file first; do NOT invent a new auth check).
   - Calls refreshAllClientPortalSnapshots.
   - Returns JSON { ok: number, failed: string[], duration_ms: number }.
   - export const maxDuration = 300 (5 min ceiling; client iteration should finish well under this).
   - Add to vercel.json cron config: schedule "*/15 * * * *" (every 15 min).
   - PUBLIC_PREFIXES carve-out in lib/auth/public-routes.ts — cron Bearer auth needs to bypass session middleware (memory: feedback_middleware_swallows_bearer_auth).

5. app/(dashboard)/clients/[id]/page.tsx (MODIFY)
   - BEFORE the existing Promise.all at line ~90:
     - Call `const snapshot = await readClientPortalSnapshot(id);`
     - If snapshot is non-null: skip the loadClientPortalByClientId call in the Promise.all (or pass it as preloadedPortal to the existing dedup logic from PR #641). Use the snapshot's payload as the portal data.
     - If snapshot is null: fall back to the existing live-load path UNCHANGED.
   - DO NOT remove the existing live-load path. It's the fallback.
   - Add a console.error log line `[client-portal] cache hit / cache miss / cache stale` for diagnostic visibility (single line, key=value style, harmless).

6. lib/db/client-portal-server.ts (MODIFY)
   - Add an optional `force?: boolean` flag to loadClientPortalByClientId to bypass the snapshot read (for cron + admin debug paths). When force=true, skip the snapshot check.
   - DO NOT change the public return type. Just add the optional param.

7. (OPTIONAL ADMIN) app/admin/refresh-client-portal-snapshots/page.tsx (NEW, optional)
   - Admin-only page with a button "Refresh all client portal snapshots now". POSTs to a new admin route /api/admin/refresh-client-portal-snapshots that calls refreshAllClientPortalSnapshots once.
   - Shows the {ok, failed, duration_ms} result.
   - Mirror existing admin auth pattern. DO NOT invent.
   - If this adds too much complexity, defer to a follow-up PR — flag in PR description.

8. PR DESCRIPTION MUST INCLUDE
   - Migration name + integer claimed.
   - Confirmation that the cron auth pattern matches refresh-active-creatives.
   - Confirmation that the new cron is added to vercel.json + the new admin route is in PUBLIC_PREFIXES.
   - Before/after cold-load timing on /clients/{4thefans-id} (snapshot warm vs cold). Capture from local dev with the cron triggered manually.
   - Output of refreshAllClientPortalSnapshots run after migration applied (number of snapshots written, any failures).
   - Confirmation that build_version invalidation works: deploy a no-op change, confirm the old snapshot is bypassed on next request.

CONSTRAINTS — STRICT
- DO NOT change the ClientPortalData return type or shape.
- DO NOT add a new caching library (Redis, KV). Supabase is the cache.
- DO NOT process clients in parallel in the cron (memory: burstable cascade pattern).
- DO NOT use console.log/warn for cron diagnostics. console.error only.
- DO NOT add a new Suspense boundary or change loading.tsx — separate concern.
- DO NOT touch the existing live-load path beyond adding the snapshot read at the top of the page.
- Apply the migration via mcp__supabase__apply_migration in the PR's session, NOT via execute_sql (memory: feedback_migration_workflow_discipline).
- Match existing TypeScript strict mode, ESLint config, import patterns.
- Branch: cursor/perf/client-portal-snapshot-cache.

VALIDATION GATE
- npm run build: exit 0.
- npm run lint: clean on touched files.
- Existing tests pass.
- Migration applied via Supabase MCP. Verify via list_migrations.
- Cold-load timing capture: local dev, run `rm -rf .next/cache && npm run dev`, navigate to /clients/{4thefans-id}. Trigger cron once manually to populate snapshot. Cold-load again with snapshot warm. Capture both timings.
- Smoke test ALL active clients still load correctly: 4thefans, Junction 2, Ironworks, Louder, Jackies. The snapshot path AND the live-load fallback both work for each.
- build_version invalidation: confirm that a fresh build's commit SHA bypasses snapshots from prior commit. Document the verification in PR description.

ASK BEFORE DOING IF
- The cron auth pattern in refresh-active-creatives is materially different from what the prompt implies — surface and confirm before mirroring.
- PUBLIC_PREFIXES isn't where I think it is — surface the actual path.
- The ClientPortalData shape has non-serializable fields (Date, Map, Set, Function refs) that don't survive JSONB round-trip — surface and ask for guidance on coercion before silently coercing.
- The clients table has soft-delete or active-flag semantics that affect which clients should be in the cron's iteration — surface the schema.

OUT OF SCOPE — DO NOT BUILD HERE
- Shared layout via React context (different problem, not the cold-load issue).
- Suspense streaming / loading.tsx changes.
- Asset queue load issue.
- Anything Remotion / unrelated cron / unrelated migration.
- Surface 2 (D2C milestone scheduler) or Surface 3 (cohort benchmarks) work from the 2026-06-18 reflection.
```

## After Cursor opens the PR

1. Verify the before/after cold-load timing is in the PR description and is real (locally measured).
2. Apply the migration via Supabase MCP if not already applied — DO NOT use execute_sql per memory.
3. **Deploy to Preview, set FEATURE off if there's a flag — no flag here.** Snapshot is read-only on cold (returns null on miss → live fallback). Safe to merge directly.
4. After merge, Production redeploys → snapshot table empty → first request to each client falls back to live load → cron at next 15-min tick populates the table → next request is fast.
5. **You don't need to flag-flip anything.** The fallback path is the safety net. If snapshot read errors for any reason, the live load runs as before.

## Expected impact

- **Cold load post-cron-tick on 4thefans: ~600-800ms** (vs 5+s today). Single Supabase query for the snapshot, fast JSONB decode, server render.
- **First request after deploy: 5s (live load, snapshot table empty for this build_version)**. Next cron tick (max 15 min later) populates the snapshot. Subsequent requests fast.
- **In-client tab switching:** unchanged from PR #641 + PR #643 state. The tabs are still local useState. But the *initial* land on the client is now <1s, which is what you actually feel when you switch clients.

## Why this is the right next move

The cold load is the binding constraint after PR #641 + PR #643. We can layer more prefetch tricks or shared-layout architecture forever — none of it removes the 5s the DB takes to assemble `ClientPortalData` live. The snapshot cache is the actual fix because it changes the question from "how do we make the DB faster" to "how do we avoid hitting the DB at all on the hot path." 15-min staleness is acceptable for what this dashboard is used for; if a client opens the dashboard and sees a number that's <15 min behind the API, that's fine.

This is also the cleanest piece of architecture in the whole perf sprint because it has a proven prior art in your own codebase (PR #87 share reports). No new patterns being invented.
