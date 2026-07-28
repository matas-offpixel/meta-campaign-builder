# Session log — BM Asset Sync v2, PR B: page audience-access task

## PR

- **Number:** 727
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/727
- **Branch:** `cursor/ops/bm-grant-task-types`

## Summary

PR B of the BM Asset Sync v2 arc (A = #726, merged as `4bc6d65`). Meta treats
"can advertise on this page" and "can build audiences from this page" as two
INDEPENDENT tasks on the same `assigned_users` edge. V1 (migration 145) only
ever granted `ADVERTISE`, so a page could look completely healthy in
`/business-managers`, serve ads fine, and still be refused as a Similar-Pages /
engagement audience seed with subcode 1713140 "audience creation permission
missing". That is the 2026-07-27→28 symptom where the wizard's audience builder
silently skipped 12 seed pages that were plainly visible in Ads Manager.

This PR tracks the audience capability separately, surfaces it per-page and
per-BM in the dashboard, and adds per-page + bulk grants for it — with success
established by READ-BACK rather than by the POST returning 200.

## Scope / files

**Migration**

- `supabase/migrations/148_bm_page_audience_access.sql` — `bm_pages` gains
  `user_tasks text[]` (the evidence) and `user_has_audience_access boolean` (the
  indexable derived flag), plus a partial index on the actionable set. Clears
  `client_business_managers.last_scanned_at` so every BM reads as needing a
  rescan (the new columns hold no Meta-sourced data until one runs).

**Meta layer**

- `lib/meta/business-manager-grant-request.ts` — new
  `buildGrantUserPageTasksRequest` primitive (explicit task set);
  `buildGrantUserPagePermissionRequest` now delegates to it, so v1's ADVERTISER
  payload is unchanged and provably so (test below).
- `lib/meta/business-manager.ts` — new `grantUserPageTasks`; same edge, same
  required `business` body param, same single-shot no-retry policy.

**Domain**

- `lib/bm/page-tasks.ts` (new, dependency-free) — the task vocabulary and the
  two pure decisions: `derivePageAccessFlags` (tasks → flags) and
  `buildAudienceGrantTasks` (existing tasks → grant payload).
- `lib/bm/grant-page-audience.ts` (new) — the grant runner, with read-back
  verification.
- `lib/bm/sync.ts` — `/me/accounts` was already fetched with `fields=…,tasks`;
  the tasks were being thrown away. Now kept, and both flags derived from them.
  `accessible` became a Map (id → tasks) instead of a Set.
- `lib/bm/types.ts` — `BMPage` + `BusinessManagerSummary` + `ScanResult` gain
  the audience fields; new `AudienceGrantOutcome`, `isAudienceGrantSuccess`,
  `describeAudienceGrantResult`; new `BMPageGrantIntent`.
- `lib/db/business-managers.ts` — `setPageTaskState`,
  `getMissingAudienceAccessPageIds`, audience counts in the summary query.

**Routes / cron / UI**

- `POST /api/business-managers/[bizId]/pages/[pageId]/grant-audience`
- `POST /api/business-managers/[bizId]/pages/grant-audience-all`
- `GET  …/pages` also returns `missingAudienceAccessCount`
- `app/api/cron/bm-page-scan` — audience misses in the run totals + log line
- `components/admin/business-managers/bm-page-list.tsx` (new) — replaces the
  Pages tab's "per-page detail lives in the inbox above" placeholder with a real
  per-page list carrying both capabilities and both row actions
- `bm-dashboard.tsx` — "Audience access" column (Pages tab only) and a
  "Grant audience access to all" header action

## MCP / live-verification log

Per the PR A discipline: assumptions about Meta are verified against the live
API, not the docs. PR A caught three wrong docs-derived assumptions this way.

### Supabase MCP (project `zbtldbfjbhfvpksmdvnt`)

- `list_migrations` → latest applied is `20260728193437 147_bm_multi_asset_sync`.
  Confirms 148 is the next number.
- `execute_sql` on `information_schema.columns` for `bm_pages` → 11 columns,
  no task/audience column of any kind, confirming the shape migration 148
  extends:
  `id, business_id, page_id, page_name, category, is_owned_by_bm,
  user_has_access, followers, avatar_url, first_seen_at, last_seen_at`.

### Meta Graph API

- **Docs are not a usable source for this enum.** `GET
  developers.facebook.com/docs/graph-api/reference/page/assigned_users/`
  (v25.0) documents the `tasks` parameter only as "Page permission tasks to
  assign this user" — it never enumerates the accepted values. It does confirm
  two things the code relies on: `business` is a REQUIRED parameter, and reading
  the edge needs `pages_manage_metadata` (which this token lacks — PR A recorded
  code 10 on that read).
- **Meta Ads MCP (`user-meta-ads`) has no business-asset tools** — same finding
  as PR A. Its surface is campaigns / ad sets / ads / audiences / creatives /
  tokens. Asset-permission verification therefore runs as direct Graph calls
  with the operator token, as in PR A.

#### ⚠️ VERIFICATION GATE — the one thing this PR must not ship without

`PAGE_TASK_AUDIENCE` in `lib/bm/page-tasks.ts` is the single place the task
string appears. It MUST be confirmed against a live capture before merge.

Status at time of writing: **BLOCKED** — the app-level quota has been saturated
since PR A's live-fire session:

```
{"error":{"message":"(#4) Application request limit reached","type":"OAuthException",
"is_transient":true,"code":4,"fbtrace_id":"AMTYxCNbXwURwZO2BD5TYrz"}}
```

Note that a `#4` rejection carries **no `X-App-Usage` header**, so no retry
estimate can be derived from the response — `estimateRetryAfterMinutes` falls
back to its ~45 minute default for exactly this reason.

The queued capture (`/tmp/bmverify/pageB_stage1.py`) does four things the moment
the window clears, in increasing order of authority:

1. `GET /me/accounts?fields=id,name,tasks` — the operator's real page tasks;
   shows whether the audience task appears in practice and under what spelling.
2. `GET /{businessScopedUserId}/assigned_pages?fields=id,name,tasks,permitted_tasks`
   — `assigned_pages` is reachable (PR A: n=100), and `permitted_tasks` would
   give the assignable set directly.
3. `GET /{bizId}/owned_pages?fields=id,name,assigned_users.business(<biz>){id,tasks,permitted_tasks}`
   — the business-node field expansion that worked for the three v2 kinds in PR
   A, as a way around the blocked page-node read.
4. **The definitive test:** `POST /{pageId}/assigned_users` with
   `tasks:["__ENUM_PROBE__"]`. A rejected write makes Meta enumerate the values
   it will accept, which is the only source that cannot be stale. Harmless — it
   cannot succeed.

## Design decisions worth reviewing

**1. The audience grant posts a SUPERSET, not the audience task alone.**

The brief asked for a byte-diff assertion that the payload carries the audience
task and not `["ADVERTISE"]`. It does. But `POST /{pageId}/assigned_users` SETS
a user's task list on the asset rather than appending to it, so posting the
audience task *by itself* onto a page that already had `ADVERTISE` is a request
to hold only the audience task — which would strip advertising and stop live ad
delivery on that page. `buildAudienceGrantTasks` therefore returns
`[...existing, AUDIENCE]`, which is additive and idempotent whichever semantics
Meta applies. A bulk "grant audience access to all" across ~50 BMs is precisely
where the destructive version would have done real damage.

**2. Success requires read-back confirmation, not a 200.**

`isAudienceGrantSuccess` is false unless `confirmed === attempted`. Trusting the
POST response would reproduce this PR's own bug class one layer down: Meta
reporting success while the audience call still gets refused. Verification is
ONE `/me/accounts` call per run (page-level `assigned_users` reads need
`pages_manage_metadata`), so it costs O(1), not O(pages). A page missing from
the read-back keeps its stored flags — a lagging read must never clear a flag.

**3. `user_has_access` semantics deliberately unchanged.**

It stays "appears in `/me/accounts` at all", exactly as migration 145 computed
it, rather than tightening to "has ADVERTISE". Tightening would silently
re-flag every page where the operator holds only a read-ish role across ~50 BMs
— a behaviour change this PR has no mandate for. Guarded by a test.

**4. v1's grant path is untouched.**

`lib/bm/grant.ts` is not edited. The batching / throttling / rate-limit-halt
policy is copied into `grant-page-audience.ts` rather than refactored into a
shared runner, because refactoring would have meant editing the code path every
live launch depends on. A test byte-diffs v1's ADVERTISER payload to prove the
request-builder refactor changed nothing.

**5. Backfill is pessimistically `false`.**

A false "missing" costs one redundant grant call (a re-grant of an existing task
is accepted). A false "granted" would leave the audience builder silently
skipping pages — the bug being fixed. So the safe direction is to assume
missing until Meta says otherwise.

## PR C hand-off note

Per the standing instruction: PR C joins `bm_ig_accounts` on **`ig_user_id`**,
never `ig_asset_id`. The wizard's IG picker validates against
`/{ad_account}/instagram_accounts`, which returns IG *user* ids, while BM asset
sync enumerates `owned_instagram_assets`, which returns *business asset* ids.
Migration 147 stores both columns precisely so PR C can join without
cross-space feeding. PR B touches no IG code path, so nothing here interacts
with PR #725's picker.

## Validation

- [x] `npx tsc --noEmit` — no errors in any touched file (repo-wide baseline
      noise in `__tests__/route.test.ts` jest-typed files and a stale
      `.next/dev/types` validator entry is pre-existing and unrelated)
- [x] `npm run build` — exit 0; both new routes registered
      (`/api/business-managers/[bizId]/pages/[pageId]/grant-audience`,
      `/api/business-managers/[bizId]/pages/grant-audience-all`)
- [x] `npx eslint` on all touched paths — clean
- [x] `lib/bm` tests: 64 pass / 0 fail (25 new in
      `page-audience-access.test.ts`)
- [ ] **live task-string capture** — see the verification gate above
- [ ] post-deploy smoke test: grant audience access to an LWE page (Ironworks),
      rerun the wizard's audience builder, confirm the previously-skipped
      Similar Pages audience for that page now succeeds

## Notes

- Pre-existing test failures unrelated to this PR (same baseline as PR A):
  `lib/meta/__tests__/creative-buy-tickets-cta.test.ts`,
  `lib/dashboard/__tests__/venue-trend-points.test.ts`,
  `lib/db/__tests__/canonical-tickets-window.test.ts`.
- The dashboard's Pages tab previously had no per-page detail at all (the
  expanded row was a pointer to the new-pages inbox). It now lists pages
  ordered by actionability, capped at 200 rows — a very large BM (Columbo
  Group, ~1060 pages) would otherwise render the lot.
