# Session log — Meta System User token (Phase 1 canary)

## PR

- **Number:** 390
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/390
- **Branch:** `cursor/meta-system-user-canary`

## Summary

Phase 1 of the per-client Meta token migration described in
`docs/META_TOKEN_ARCHITECTURE_2026-05-11.md`. Adds an encrypted-at-rest
**Meta Business Manager System User token** column on `clients`, an
admin endpoint + client-detail UI to provision it, and routes the two
highest-volume non-interactive paths (rollup-sync Meta leg + audience
bulk write) through a new resolver that prefers the System User token
and falls back to the personal-OAuth token when one isn't provisioned.
The change is gated behind `OFFPIXEL_META_SYSTEM_USER_ENABLED` so a
single env flip rolls it back without reverting the migration.

The expected operational win is that the rollup-sync cron and the
audience builder stop sharing Matas's `#17` per-user rolling rate-limit
bucket — System User tokens hit Meta's per-ad-account *Business Use
Case* bucket instead. Concrete WC26 motivation: the 61-event audience
build was tripping `#17` lockouts in parallel with `rollup-sync-events`
and `refresh-creative-insights`; this canary unblocks that.

## Scope / files

### Migration

- `supabase/migrations/090_clients_meta_system_user_token.sql`
  - Adds `clients.meta_system_user_token_encrypted bytea`,
    `meta_system_user_token_set_at`, `meta_system_user_token_last_used_at`.
  - `set_meta_system_user_token`, `get_meta_system_user_token`,
    `clear_meta_system_user_token` RPCs (SECURITY DEFINER, REVOKE from
    anon / authenticated, GRANT EXECUTE to `service_role` only).
  - **Note on numbering:** the design doc references "075"; that slot
    was taken on main, so this lands as **migration 090**. Same
    schema, same RPCs.

### Resolver + helpers

- `lib/meta/system-user-token.ts` — `resolveSystemUserToken(clientId,
  supabase, options?)`. Returns `{ token, source: "system_user" }` or
  `null`. Never throws. Stamps `meta_system_user_token_last_used_at`
  on success (fire-and-forget). Honours
  `OFFPIXEL_META_SYSTEM_USER_ENABLED` (off ⇒ no DB read, no log spam).
  `createServiceRoleClient` is dynamically imported so the unit tests
  can run under `node --test` without a `next/headers` shim.
- `lib/meta/audience-write-token.ts` — `resolveAudienceWriteToken`
  helper used by audience writes. Deliberately does *not* import
  `server-only` (mirrors `lib/meta/server-token.ts`) so the unit tests
  load cleanly. Inlines a copy of `findClientByMetaAdAccountId` to
  avoid pulling `lib/db/clients.ts` (which has a browser-side
  `lib/supabase/client` import) into the test graph.
- `lib/db/clients.ts` — adds the canonical
  `findClientByMetaAdAccountId(supabase, adAccountId)` helper for
  non-resolver callers per the brief.

### Routed call sites

- `lib/meta/audience-write.ts` — `createMetaCustomAudience` and
  `archiveMetaCustomAudience` now resolve via
  `resolveAudienceWriteToken` (System User → personal → env fallback).
- `lib/dashboard/rollup-sync-runner.ts` — Meta leg (post-fetch) and
  allocator leg (post-write) now resolve via the new
  `resolveMetaTokenForRollupSync` helper. The runner already received
  `clientId` from the cron + share-token + share-token routes, so no
  call-site signature change. `SyncDiagnostics.metaTokenSource` /
  `SyncSummary.metaTokenSource` surface which family supplied the
  token, and the existing `[rollup-sync] done …` log line includes
  `meta_token_source=…`.
- `app/api/cron/rollup-sync-events/route.ts` — surfaces per-event
  `metaTokenSource` in each `EventSyncResult` and adds a top-level
  `metaTokenSourceCounts` aggregate (`{ system_user, db, env,
  unresolved }`) to the JSON response. The summary log now prints the
  per-source counts.

### Admin endpoint + UI

- `app/api/clients/[id]/meta-system-user-token/route.ts` — POST /
  DELETE / GET handlers. POST validates the raw token via Meta's
  `/debug_token` (must come back `is_valid:true` with
  `ads_management` in `scopes`) before persisting. DELETE clears
  the encrypted column + both timestamps in one RPC. All three
  short-circuit with 503 when the env flag is off so the UI can
  hide the panel cleanly.
- `components/dashboard/clients/meta-system-user-token-card.tsx` —
  collapsed "Advanced: Meta System User token" card on the client
  detail Overview tab. Single textarea + Save / Replace / Remove.
  Masked preview + set/last-used timestamps after save.
- `components/dashboard/clients/client-detail.tsx` and
  `app/(dashboard)/clients/[id]/page.tsx` — wires the panel through
  with server-rendered initial state. The card is rendered only when
  `OFFPIXEL_META_SYSTEM_USER_ENABLED=true`. Note: the Phase 1 brief
  pointed at `components/wizard/steps/account-setup.tsx`, which is the
  per-campaign wizard step (no per-client settings section). The
  per-client surface lives on the client detail Overview tab in
  `client-detail.tsx`, so the new card slots in below the existing
  "Meta Business assets" / `PlatformAccountsCard` block — the same
  visual hierarchy operators already use for per-client Meta config.

### Tests

- `lib/meta/__tests__/system-user-token.test.ts` — happy path, no-row
  → null, no-key → null, RPC error → null, feature flag off ⇒ no DB
  read. Plus contract assertions for the API route's `/debug_token`
  guard (rejects `is_valid:false` and missing `ads_management`).
- `lib/meta/__tests__/audience-write.test.ts` — adds three resolver
  tests asserting "prefers system user when present, falls back to
  personal when null, falls back when no client row matches".

## Validation

- [x] `npm run lint` — no new warnings/errors in modified files
  (existing pre-PR warnings in `lib/hooks/useMeta.ts` and friends
  remain).
- [x] `npm run build` — clean.
- [x] `npm test` — 1023/1024 pass. The single failure
  (`lib/audiences/__tests__/batch-fetch-video-metadata.test.ts`)
  reproduces on stashed-clean `main` and is unrelated to this PR.

## Gating / verification (per the brief)

These are the operator steps once the PR is merged. They are NOT done
in this PR:

1. **Migration must be verified applied in Supabase prod** (Supabase
   MCP `apply_migration` followed by a `list_migrations` confirmation)
   before any traffic flips.
2. Provision Matas's 4thefans System User in Business Manager,
   capture the token, save via the new client-detail card.
3. Run `/api/cron/rollup-sync-events?clientId=<4tF-id>` and verify
   the per-event `metaTokenSource=system_user` lands in the JSON +
   that `metaTokenSourceCounts.system_user >= 1`.
4. Run one full audience-builder bulk-create against 4thefans (3
   funnel stages × 1 test event). Confirm the `[audience-write]
   tokenSource=system_user …` log lines fire and that no `#17` errors
   surface on a parallel rollup-sync run.
5. Smoke test rollback: with
   `OFFPIXEL_META_SYSTEM_USER_ENABLED=false` set, the resolver MUST
   short-circuit before any DB read (verified by the
   `metaSystemUserEnabled` test). Run a cron tick and confirm every
   event's `metaTokenSource` shows `db` (or `env`).

## Notes

- **Out of scope (separate PRs):** all `app/api/meta/*` UI routes
  (Phase 3), all `getOwnerFacebookToken` share paths (Phase 2), the
  `/me/ad-accounts → /{business_id}/owned_ad_accounts` swap (Phase 3
  gotcha), and a "test connection" button on the card.
- **`server-only` package:** the new resolver does not import
  `"server-only"` (matching `lib/meta/server-token.ts`). The
  `createServiceRoleClient` factory still requires the server-only
  `SUPABASE_SERVICE_ROLE_KEY` env var so the runtime safety posture
  is preserved.
- **Type generation:** `lib/db/database.types.ts` does not yet know
  about the new columns or RPCs — generated types should be
  refreshed via `supabase gen types` post-merge. Until then the
  resolver + admin route cast through `unknown` at the new column
  reads.
- **Branch convention:** `cursor/meta-system-user-canary` per
  `CLAUDE.md`. PR will be opened with `gh pr create` and merged via
  `gh pr merge --auto --squash --delete-branch` once the smoke test
  in §"Gating / verification" lands.
