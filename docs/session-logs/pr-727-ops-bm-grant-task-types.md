# Session log — BM Asset Sync v2, PR B: validated page task-set grants

## PR

- **Number:** 727
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/727
- **Branch:** `cursor/ops/bm-grant-task-types`

## Headline: the brief's premise was wrong, and the live capture is what caught it

PR B was scoped to fix the wizard's audience builder by granting a page task
called `AUDIENCE_MANAGE`. **That task does not exist.** A live capture against
Graph v23.0 on 2026-07-28 enumerated every task
`POST /{pageId}/assigned_users` accepts, and there is no audience task among
them. Had the original scope shipped, every grant in a bulk run across ~50
client BMs would have failed with code 100, and the 12 silently-skipped seed
pages from the 2026-07-27→28 incident would still be skipped.

So this PR ships what survives that finding: the **task-set grant machinery**,
with a fail-fast validator that makes this class of mistake impossible to repeat,
and per-page **evidence capture** so the follow-up PR can diagnose subcode
1713140 empirically instead of by assumption.

## MCP / live-verification log

Per the PR A discipline: assumptions about Meta are verified against the live
API, not the docs. In PR A that caught three wrong docs-derived assumptions. In
this PR it invalidated the whole brief.

### The capture that decided this PR

`GET /{pageId}/assigned_users` is gated behind `pages_manage_metadata`, which the
operator token does not hold (PR A recorded code 10 on that read), and the
business-node field expansion that worked for the three v2 asset kinds in PR A
does not expose `permitted_tasks` for pages. So the accepted set was obtained the
only way left: **POST an invalid task and let Meta enumerate what it accepts.**
Harmless — the write cannot succeed.

Request:

```
POST /v23.0/1026165617251103/assigned_users
{ "business": "944651277948334",
  "user": "122121443048950557",
  "tasks": ["__ENUM_PROBE__"] }
```

Response, verbatim (also committed as
`lib/bm/__tests__/fixtures/page_assigned_users_enum_probe.json`):

```json
{
  "error": {
    "message": "Your request has violated JSON schema constraint 'enum' for the JSON field 'tasks.0', please check the JSON schema for the JSON field 'tasks.0' and make sure your request is valid for expected : '[FULL_CONTROL, CONTENT, MESSAGES, COMMUNITY_ACTIVITY, ADVERTISE, ANALYZE, IG_APP_ADMIN, IG_APP, SPARK_INSIGHTS, SPARK_PUBLISH, SPARK_EVERYTHING, CREATOR_MANAGEMENT, CREATIVE_MANAGEMENT]' but got '__ENUM_PROBE__'",
    "code": 100,
    "type": "OAuthException",
    "fbtrace_id": "AUqmfr2_VjuA6BLk7LTFfxw"
  }
}
```

Three conclusions:

1. **No audience task exists on this edge.** Subcode 1713140 is therefore not
   caused by a missing page user-task, so no page grant can fix it. The cause is
   something else — most plausibly a business-level asset condition — which is
   exactly what PR C will now investigate against real evidence.
2. **Pages use the unified business-asset vocabulary**, the same one PR A found
   on Instagram assets: `CONTENT` not `CREATE_CONTENT`, `FULL_CONTROL` not
   `MANAGE`. The legacy page-role names (`MANAGE`, `MODERATE`, `MESSAGING`,
   `CREATE_CONTENT`) are **rejected** here. Anything written from memory of the
   old page-roles API would fail.
3. The reference note in memory listing `AUDIENCE_MANAGE` as a Pages task is
   **wrong** and should be corrected before PR C inherits it.

The docs were checked too and are not a usable source for this:
`developers.facebook.com/docs/graph-api/reference/page/assigned_users/` (v25.0)
describes `tasks` only as "Page permission tasks to assign this user" and never
enumerates the values. It does confirm two things the code relies on: `business`
is a REQUIRED parameter, and reading the edge needs `pages_manage_metadata`.

Rate limiting: the capture was blocked for most of the session by an app-level
`(#4) Application request limit reached`. Worth recording that a `#4` rejection
carries **no `X-App-Usage` header**, so no retry estimate can be derived from it
— which is why `estimateRetryAfterMinutes` falls back to ~45 minutes. Once the
window cleared, the probe was run as a single targeted call rather than the
four-stage script, to spend as little quota as possible.

### Meta Ads MCP

`user-meta-ads` has **no business-asset tools** — same finding as PR A. Its
surface is campaigns / ad sets / ads / audiences / creatives / tokens. Asset
permission work therefore runs as direct Graph calls with the operator token.

### Supabase MCP (project `zbtldbfjbhfvpksmdvnt`)

- `execute_sql` on `information_schema.columns` for `bm_pages` **before** the
  migration → 11 columns, no task column of any kind:
  `id, business_id, page_id, page_name, category, is_owned_by_bm,
  user_has_access, followers, avatar_url, first_seen_at, last_seen_at`.
  This also confirmed the abandoned `user_has_audience_access` boolean had never
  been applied, so the revised migration is a clean add rather than a drop.
- `apply_migration` → `{"success": true}`.
- `execute_sql` **after** → `user_tasks ARRAY default '{}'::text[]`,
  `last_grant_requested_tasks ARRAY`, `last_grant_at timestamptz`, and no
  `user_has_audience_access`.
- `list_migrations` → recorded as `20260728205821 148_bm_page_task_audit`.

**Migration numbering collision.** Another thread applied a `148_` migration
(thumbnail-hash index) at 20:30 the same evening; this one landed at 20:58. The
file is therefore renumbered to **`149_bm_page_task_audit.sql`** while the ledger
entry keeps the name it was applied under — per `MIGRATIONS_NOTES.md`, the
numeric prefix is a readability convention with no execution meaning. The column
comments were re-issued to say 149 so the database matches the file, and the
collision is recorded in `MIGRATIONS_NOTES.md`.

## Scope / files

**Migration**

- `supabase/migrations/149_bm_page_task_audit.sql` — `bm_pages` gains
  `user_tasks text[]` (what Meta reports), `last_grant_requested_tasks text[]`
  and `last_grant_at` (what we asked for, and when), plus a GIN index on
  `user_tasks` so PR C can ask containment questions across ~50 BMs. Clears
  `client_business_managers.last_scanned_at` so every BM honestly reads as
  needing a rescan — the new columns hold no Meta-sourced data until one runs.

**Meta layer**

- `lib/meta/business-manager-grant-request.ts` — new
  `buildGrantUserPageTasksRequest` primitive (explicit task set);
  `buildGrantUserPagePermissionRequest` now delegates to it, so v1's ADVERTISER
  payload is unchanged and provably so (test below).
- `lib/meta/business-manager.ts` — new `grantUserPageTasks`; same edge, same
  required `business` body param, same single-shot no-retry policy.

**Domain**

- `lib/bm/page-tasks.ts` (new, dependency-free) — the captured enum as a
  versioned constant with its provenance, `validatePageTasks` (fail-fast),
  `derivePageAccessState`, `buildAdditiveTaskGrant`, `grantSatisfiedForPage`.
- `lib/bm/grant-page-tasks.ts` (new) — the grant runner: validate, build a
  per-page superset payload, throttle, verify by read-back.
- `lib/bm/sync.ts` — `/me/accounts` was already fetched with `fields=…,tasks` and
  the tasks were being thrown away. Now kept (`accessible` is a Map id → tasks
  rather than a Set), so capturing them costs **zero** extra Graph calls.
- `lib/bm/types.ts` — `BMPage` gains `user_tasks` +
  `last_grant_requested_tasks` + `last_grant_at`; new `TaskGrantOutcome`,
  `isTaskGrantSuccess`, `describeTaskGrantResult`.
- `lib/db/business-managers.ts` — `setPageTaskState` (observed) and
  `recordPageGrantRequest` (requested).

**Routes / cron / UI**

- `POST /api/business-managers/[bizId]/pages/grant-tasks` — body `{tasks}`
- `POST /api/business-managers/[bizId]/pages/[pageId]/grant-tasks` — body `{tasks}`
- Both reject an invalid task set with **400 before any Graph call**, quoting the
  accepted enum in the message.
- `components/admin/business-managers/bm-page-list.tsx` (new) — replaces the
  Pages tab's "per-page detail lives in the inbox above" placeholder with a real
  per-page list showing the operator's actual tasks, a task picker restricted to
  the grantable subset, and per-page + bulk grant actions. Rows whose last grant
  requested something Meta never reported back say so.
- `bm-dashboard.tsx` — `postJson`/`run` now carry a JSON body; grant notices
  prefer a read-back-confirmed count when the run reports one.

## Design decisions worth reviewing

**1. The validator is the actual deliverable.**

`validatePageTasks` checks a requested set against the captured enum before
spending a Graph call, and quotes the accepted values in the error. It is the one
piece of this PR that would have caught this PR's own root cause: `["AUDIENCE_MANAGE"]`
now fails locally with *"Not a Meta page task: AUDIENCE_MANAGE. Accepted (Graph
v23.0, captured 2026-07-28): …"* instead of failing 50 times against Meta with
code 100. A test asserts exactly that, so the dead task cannot creep back in.

**2. Grants post a SUPERSET, never the new tasks alone.**

`POST /{pageId}/assigned_users` SETS a user's task list on the asset rather than
appending, so posting `[ANALYZE]` onto a page that already had `ADVERTISE` is a
request to hold *only* `ANALYZE` — which would strip advertising and stop live ad
delivery. `buildAdditiveTaskGrant` returns the union, which is additive and
idempotent whichever semantics Meta applies. A bulk grant across ~50 BMs is
precisely where the destructive version would have done real damage.

**3. The tool refuses owner-level tasks even though Meta accepts them.**

`FULL_CONTROL`, `IG_APP_ADMIN` and `SPARK_EVERYTHING` are in the enum and are
blocked in `PAGE_TASKS_NEVER_GRANTED`. `/business-managers` promises the operator
"enough to run ads, no owner-level actions" on someone else's client asset;
enforcing that in the validator means a future caller cannot quietly escalate it.

**4. Success requires read-back confirmation, and confirmation is a superset test.**

`isTaskGrantSuccess` is false unless `confirmed === attempted`. Trusting the POST
would reproduce this arc's own failure class: Meta reporting success while the
capability is absent. Verification is ONE `/me/accounts` call per run (page-level
`assigned_users` reads need `pages_manage_metadata`), so it costs O(1) not
O(pages). The check is `requested ⊆ observed`, never equality, because PR #726
verified Meta EXPANDS grants — one requested `ADVERTISE` on an IG asset read back
as five tasks. A page missing from the read-back keeps its stored state; a
lagging read must never clear a flag.

**5. Evidence, not a verdict, in the schema.**

The original design was a `user_has_audience_access` boolean. A boolean named
after a task that does not exist would have been a lie in the schema. Storing the
observed task list plus what the last grant requested means PR C can correlate
"pages where audience creation fails" against "tasks the operator verifiably
holds" — and the (requested, observed) delta is the only reliable record of what
Meta actually did with a request, given that it expands some tasks and silently
drops others.

**6. `user_has_access` semantics deliberately unchanged.**

It stays "appears in `/me/accounts` at all", exactly as migration 145 computed
it, rather than tightening to "has ADVERTISE". Tightening would silently re-flag
every page where the operator holds only a read-ish role across ~50 BMs — a
behaviour change this PR has no mandate for. Guarded by a test.

**7. v1's grant path is untouched.**

`lib/bm/grant.ts` is not edited. The batching / throttling / rate-limit-halt
policy is copied into `grant-page-tasks.ts` rather than refactored into a shared
runner, because refactoring would have meant editing the code path every live
launch depends on. A test byte-diffs v1's ADVERTISER payload to prove the
request-builder refactor changed nothing.

## PR C hand-off

1. **The premise for 1713140 is now open.** It is NOT a missing page user-task.
   Diagnose it where the error surfaces — the audience-creation call — and use
   the new `user_tasks` / `last_grant_requested_tasks` columns as the correlation
   basis. The GIN index exists for that.
2. **Correct the memory reference.** `reference_meta_bm_asset_grant_endpoints.md`
   lists `AUDIENCE_MANAGE` as a Pages task; it is not one. The correct enum is in
   `PAGE_PERMITTED_TASKS` with its provenance, and the raw capture is in the
   fixture.
3. **IG joins use `ig_user_id`.** Per the standing instruction, PR C joins
   `bm_ig_accounts` on `ig_user_id`, never `ig_asset_id`: the wizard's IG picker
   validates against `/{ad_account}/instagram_accounts`, which returns IG *user*
   ids, while BM asset sync enumerates `owned_instagram_assets`, which returns
   *business asset* ids. Migration 147 stores both columns precisely so PR C can
   join without cross-space feeding. This PR touches no IG code path, so nothing
   here interacts with PR #725's picker.

## Validation

- [x] Live capture of the accepted task enum (above), committed as a fixture, and
      a test that parses the enum out of the fixture and asserts the constant
      equals it — so the constant cannot drift from its stated provenance
- [x] `npx tsc --noEmit` — no errors in any touched file (repo-wide baseline noise
      in jest-typed `__tests__/route.test.ts` files is pre-existing)
- [x] `npx eslint` on all touched paths — clean
- [x] `npm run build` — exit 0; both new routes registered
      (`/api/business-managers/[bizId]/pages/grant-tasks`,
      `/api/business-managers/[bizId]/pages/[pageId]/grant-tasks`) and no
      `grant-audience*` route remains
- [x] `node --test` on `lib/bm/__tests__/page-tasks.test.ts` — 34 pass / 0 fail
- [x] Full suite: 3195 tests, 3178 pass, 14 fail — all 14 pre-existing and
      confined to `lib/audiences/__tests__/batch-fetch-video-metadata.test.ts`
      and `lib/meta/__tests__/creative-buy-tickets-cta.test.ts`, neither touched
- [x] Migration applied and verified via Supabase MCP (above)
- [ ] Post-deploy smoke: expand a BM's Pages row, confirm real task lists render
      from a fresh scan, and confirm a `["ANALYZE"]` grant on one LWE page reads
      back confirmed
- [ ] Post-deploy negative check: a `["AUDIENCE_MANAGE"]` POST to the grant route
      returns 400 with the enum in the message, without reaching Meta

## Notes

- The dashboard's Pages tab previously had no per-page detail at all (the
  expanded row pointed at the new-pages inbox). It now lists pages ordered by
  actionability, capped at 200 rows — a very large BM (Columbo Group, ~1060
  pages) would otherwise render the lot.
- Worktree note: this branch was developed in `~/worktrees/bm-grant-task-types`
  after another agent took over the primary working directory mid-session.
