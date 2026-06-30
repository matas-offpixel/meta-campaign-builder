# Session log

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cursor/perf/client-portal-snapshot-cache`

## Summary

Applies the PR #87 share-report snapshot-cache pattern to the **internal**
client portal. `loadClientPortalByClientId` now reads a warm
`client_portal_snapshots` row (per `(client_id, build_version)`, 15-min
freshness) before falling back to the existing live waterfall, dropping a cold
`/clients/[id]` (and the heavier `/clients/[id]/dashboard`, plus the Today
pacing alerts) from multi-second to a single indexed read. A 15-minute Vercel
cron (`refresh-all-client-portal-snapshots`) repopulates every active client
sequentially via the service-role writer. PR C of the 2026-06-29 perf sprint
(after #641 waterfall fixes and #643 hover-prefetch).

## Scope / files

- `supabase/migrations/123_client_portal_snapshots.sql` (NEW) — table, unique
  `(client_id, build_version)`, lookup index, owner-read RLS (join `clients`),
  service-role-only writes. **Applied to prod via Supabase MCP `apply_migration`.**
- `lib/reporting/client-portal-snapshot.ts` (NEW) — `readClientPortalSnapshot`
  (RLS anon client, build_version + maxAgeMs gating) / `writeClientPortalSnapshot`
  (service-role, refuses non-ok/incomplete payloads, prunes prior-build rows).
- `lib/reporting/client-portal-snapshot-runner.ts` (NEW) —
  `refreshAllClientPortalSnapshots`, sequential, per-client 30s timeout,
  `console.error` diagnostics.
- `app/api/cron/refresh-client-portal-snapshots/route.ts` (NEW) — GET, bearer
  `CRON_SECRET` (identical helper to `refresh-active-creatives`), `maxDuration = 300`.
- `vercel.json` — new cron `*/15 * * * *`.
- `lib/db/client-portal-server.ts` — `loadClientPortalByClientId` gains
  `opts?: { force?: boolean }` and a centralized cache-first read.

## Validation

- [x] `npm run build` — exit 0; `/api/cron/refresh-client-portal-snapshots` in manifest.
- [x] `npm run lint` — clean on all touched files.
- [x] `npm test` — 2293 pass / 13 fail; the 13 are the pre-existing `@/`-alias
      `ERR_MODULE_NOT_FOUND` failures on raw Node (identical on `main`), none in new files.
- [x] Migration applied via Supabase MCP + verified (6 cols / 1 policy / 1 unique / 1 index).
- [x] Runner: `ok=10 failed=[]` across all active clients in ~34s (≪ 300s ceiling).
- [x] Timing (local→prod): cold live-load 4theFans **4.3–14.5s** vs warm
      snapshot read **~1.2s** (single indexed row; transfer-bound — sub-second
      in-region on Vercel).
- [x] build_version invalidation: a mismatched build SHA matches **0 rows** → live fallback.

## Notes

- **Design decision (steps 5/6 reconciliation):** the cache-first read is
  centralized inside `loadClientPortalByClientId` (gated by `force`) rather than
  inlined in `page.tsx`. This makes the `force` flag meaningful, leaves the
  live-load path untouched, preserves the PR #641 campaigns-loader dedup
  automatically, and extends the cache to **all** callers — `/clients/[id]`,
  `/clients/[id]/dashboard`, and the Today pacing alerts — not just the detail
  page. `page.tsx` therefore needed no change. The optional admin page (step 7)
  is deferred (the cron route + bearer secret cover manual refresh).
- **clients iteration (ASK-BEFORE gate):** `clients` has no soft-delete column;
  `status ∈ {active, paused, archived}`. The runner iterates `status != 'archived'`.
- **Serializability (ASK-BEFORE gate):** `ClientPortalData` is already JSON-safe
  (it ships over the wire to `/api/share/client/[token]`) — no Date/Map/Set; the
  JSONB round-trip is lossless. Reader defensively rejects any non-`ok` payload.
- **PUBLIC_PREFIXES:** no change needed — `/api/cron/` is already a prefix, so
  the new cron route is auto-covered; the route still enforces its own bearer auth.
- **Migration number:** claimed **123** (disk topped at 119, but the prod
  ledger already consumed names 120/121/122 — mailchimp tag-tracking + the
  PR #639 P0 covering index applied directly). 123 is free on both disk and ledger.
- **Unbounded-growth guard:** because the unique key is `(client_id, build_version)`,
  each deploy would otherwise leave a dead multi-MB row per client. The writer
  prunes prior-build rows after a successful upsert (best-effort), keeping one
  live row per client on the 500MB Nano instance.
