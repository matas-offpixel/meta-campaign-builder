# Session log — Business Manager Asset Sync (V1: Pages)

## PR

- **Number:** pending
- **URL:** {GitHub PR URL when known}
- **Branch:** `cursor/ops/business-manager-asset-sync`

## Summary

Ships an operator-only **Business Manager Asset Sync** tool at
`/admin/business-managers`. Matas is Admin on ~10+ client Business Managers, but
Meta doesn't grant BM Admins per-page asset-user access implicitly — every new
page a client adds requires a manual self-grant before he can boost posts or run
ads. This tool enumerates every page across the BMs his Facebook account belongs
to, flags pages where he lacks a direct user role, one-click grants himself
**ADVERTISER** on flagged pages (batched, audited), and runs a daily cron that
detects newly-added pages and surfaces them in a UI inbox.

**V1 scope: Pages only.** Ad accounts / pixels / IG / custom audiences are
deliberately out of scope (future extensions on the same shape).

## Scope / files

**Migration**
- `supabase/migrations/145_business_manager_asset_sync.sql` — `client_business_managers`,
  `bm_pages`, `bm_page_access_events` + RLS (authenticated read, service-role
  write, same shape as `cron_health_reports`) + pgcrypto `set_bm_access_token` /
  `get_bm_access_token` SECURITY DEFINER RPCs. **Verified latest on-disk migration
  was 144 → claimed 145** (the Supabase MCP was unavailable this session; verified
  against the migrations directory, which is authoritative for the repo).

**Meta API layer**
- `lib/meta/business-manager.ts` — `listBusinessManagers`, `listOwnedPages`,
  `listClientPages`, `listUserAccessiblePages`, `getMetaUserId`,
  `grantUserPagePermission`. **Reuses `graphGetWithToken` / `graphPostWithToken`
  from `lib/meta/client.ts` verbatim** so the split transient-vs-rate-limit retry
  budget is inherited (GET reads retry; POST grants stay single-shot). No bespoke
  retry loop.

**Domain logic**
- `lib/bm/secrets.ts` — `BM_TOKEN_KEY` resolver (dedicated key, blast-radius
  isolation — NOT `D2C_TOKEN_KEY`).
- `lib/bm/user-token.ts` — resolves Matas's personal FB token from
  `user_facebook_tokens` with **no `META_ACCESS_TOKEN` fallback** (task-#10 memory).
- `lib/bm/types.ts`, `lib/bm/route-auth.ts` (operator gate),
  `lib/bm/sync.ts` (scan — detection only, subcode-190 → flag expired),
  `lib/bm/grant.ts` (batched grant: 50/batch, 2s sleep, ADVERTISER role, audit).
- `lib/db/business-managers.ts` — CRUD, encrypted-token get/set wrappers, page
  upsert with new-page detection, access-event logging, summary counts.

**Routes**
- `POST /api/business-managers/connect`, `GET /api/business-managers`,
  `GET /api/business-managers/[bizId]/pages`,
  `POST /api/business-managers/[bizId]/pages/grant-all`,
  `POST /api/business-managers/[bizId]/pages/[pageId]/grant`,
  `POST /api/business-managers/[bizId]/scan` ("Sync now").

**Cron**
- `app/api/cron/bm-page-scan/route.ts` (Bearer `CRON_SECRET`, `[bm-page-scan]` log
  prefix, detection-only — never grants) + `vercel.json` entry `"0 8 * * *"`.

**UI**
- `app/(dashboard)/admin/business-managers/page.tsx` (operator-gated server page)
  + `components/admin/business-managers/bm-dashboard.tsx` (inbox of new pages,
  connected-BM table, Sync now / Grant all, reconnect banner, empty state).
- `components/dashboard/dashboard-nav.tsx` — new "Ops → Business Managers" link.

**Docs / env**
- `.env.local.example` — `BM_TOKEN_KEY`.

## Validation

- [x] `npm run build` — exit 0. All 7 BM routes + cron registered.
- [x] `ReadLints` on all new/edited files — clean.
- [ ] Manual smoke test (connect J2 BM, scan ~59 pages, Grant all missing → 0
      missing on re-scan) — **pending** deployment with `BM_TOKEN_KEY` set +
      Matas's OAuth token present. Requires live Meta credentials, not runnable in
      this environment.

## Notes / decisions

- **BM_TOKEN_KEY (new key):** followed the landing-page blast-radius convention —
  a dedicated pgcrypto key rather than reusing `D2C_TOKEN_KEY`. Must be set in
  Vercel prod before connect/scan work.
- **Token source:** the app's existing Facebook OAuth already requests
  `business_management` scope, so `connect` reuses the stored personal token (no
  new consent screen in the common case); it validates the scope via
  `/debug_token` and returns `needsReconnect` when missing.
- **`client_id` nullable:** BMs are discovered from `/me/businesses` before being
  mapped to a CRM client, so `client_business_managers.client_id` is a nullable FK
  (`on delete set null`). Operator can associate later.
- **Detection vs action separation:** the cron only flags; all grants require an
  explicit UI click (kept off the cron path on purpose).
- **RLS:** operator dashboard reads are `authenticated using(true)` (invite-only
  app); all writes go through the service-role client after the route's operator
  gate, or through the SECURITY DEFINER credential RPCs.
- **Unrelated main hotfix:** `main` shipped a `next build`-breaking type error in
  `app/api/d2c/scheduled-sends/[id]/autoresp-backfill/start/route.ts` (PR #704 left
  a dead `channel === "email"` ternary at line 83 after adding an earlier
  email-reject return). Applied the trivial, unambiguous fix (email is already
  excluded → channel is always `bird`) so the build gate could pass. Flagging here
  since it's outside this PR's scope.

### Out of scope (do NOT build here)
- Slack/email notifications on detection · auto-grant on scan · ad account /
  pixel / IG asset extension (v2).
