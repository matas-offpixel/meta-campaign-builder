# Session log — BM Asset Sync: halt grant-all on Meta rate limit, add backoff

## PR

- **Number:** 712
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/712
- **Branch:** `cursor/bm-grant-all-rate-limit-backoff`

## Summary

`POST /api/business-managers/[bizId]/pages/grant-all` for Columbo Group
(527693220707294) got 8 pages granted, then hit Meta's app-tier
`(#4) Application request limit reached`, then **kept looping through the
rest of the batch** — verified live 2026-07-09: 200+ `sync_error` rows in
`bm_page_access_events` for the same message, all against the still-rejected
quota window. Retrying deepened the rate-limit hole instead of backing off.

## Fix

`grantPagesForBusinessManager` (`lib/bm/grant.ts`) now:

1. **Detects** Meta's app/user/ad-account quota errors (#4/#17/#80004,
   including "Application request limit reached") via the existing
   `isMetaAdAccountRateLimitError` classifier
   (`lib/audiences/meta-rate-limit.ts` — reused rather than duplicated).
2. **Halts immediately** — returns from the function on the first quota hit,
   instead of continuing through the rest of the batch/remaining batches.
3. **Records the halt** as a new `bm_page_access_events.action = 'rate_limited'`
   row (migration 146 widens the `action` CHECK constraint), with `detail`
   carrying `granted_so_far`, `total_targeted`, `retry_after_minutes`, and the
   raw `app_usage` snapshot (when Meta returned one).
4. **Estimates a retry-after** by parsing the `X-App-Usage` response header
   (`lib/meta/app-usage.ts`, new pure module) — `call_count`/`total_time`/
   `total_cputime` are percentages of the rolling ~1h app-level budget, not
   raw counts. `estimateRetryAfterMinutes` scales 0-60 min proportionally
   (floor 5 min, 60 min at ≥100% usage), falling back to the existing
   generic 45-min default (`lib/audiences/meta-rate-limit.ts`'s
   `coverGenericRateLimitBody`) when no header was captured.
5. **Surfaces partial progress** to the UI: `GrantResult` gained
   `rateLimited`, `retryAfterMinutes`, and `totalTargeted` fields.
   `describeGrantResult` now renders exactly
   `"Granted X of Y — Meta rate limit hit, retry in ~N minutes."` and
   `isFullGrantSuccess` treats a rate-limited halt as NOT a full success
   (`ok: false` from both grant routes, same as any other partial failure —
   no route/dashboard-side changes needed beyond the shared helpers).
6. **Proactive throttle** — a new `GRANT_REQUEST_DELAY_MS = 500` sleep
   between every individual grant call (on top of the existing 2s
   between-batch pause), so grant-all stays under ~2 req/s to Meta instead
   of only reacting once the limit is already blown through.

### Resume-from-last-granted — no new code needed

Re-running "Grant all missing" after a halt **already resumes correctly**:
`grantPagesForBusinessManager` re-queries `getBMPages` for pages where
`user_has_access = false` whenever `opts.pageIds` is omitted (the path both
API routes use), and each successful grant flips `user_has_access` to `true`
*before* moving to the next page. So a second run only re-attempts the pages
that never got granted — no resume-token/cursor machinery required.

### Meta app quota indicator

`lib/meta/client.ts` now snapshots the `X-App-Usage` header off of every
Meta GET/POST response (success or error) into a per-instance, in-memory
`lastAppUsage` var, exposed via `getLastKnownMetaAppUsage()`. The
`/business-managers` page (Server Component, `force-dynamic`) reads this on
each request and passes it to `BusinessManagersDashboard`, which renders a
small "App quota: N%" badge (amber ≥70%, red ≥90%) next to the page header
when a snapshot exists. This is explicitly best-effort / per-instance —
documented in the getter's docstring — it resets on cold start and isn't a
source of truth for the halt decision above (that reads the header directly
off the failing call via `MetaApiError.rawErrorData.__appUsage`).

## Scope / files

- `supabase/migrations/146_bm_rate_limited_action.sql` (new) — widens
  `bm_page_access_events.action` CHECK constraint to add `'rate_limited'`.
  Introspects `pg_constraint` for the existing constraint name rather than
  assuming it (idempotent, name-agnostic).
- `lib/meta/app-usage.ts` (new) — pure `parseAppUsageHeader` +
  `estimateRetryAfterMinutes`. No dependency on `client.ts`, safe to
  unit-test and to import from a Server Component.
- `lib/meta/client.ts` — `recordAppUsage` helper + `lastAppUsage` module
  state + `getLastKnownMetaAppUsage()` export; wired into both
  `executeGetWithRetry` and `graphPostWithToken`; the failing response's
  snapshot is also stashed onto the thrown `MetaApiError.rawErrorData.__appUsage`.
- `lib/bm/grant.ts` — halt-on-rate-limit branch, `extractAppUsage` helper,
  `GRANT_REQUEST_DELAY_MS` per-request throttle, `totalTargeted` bookkeeping.
- `lib/bm/types.ts` — `BMAccessAction` += `'rate_limited'`; `GrantResult` +=
  `totalTargeted`/`rateLimited`/`retryAfterMinutes`; `isFullGrantSuccess` +=
  `!rateLimited`; `describeGrantResult` += rate-limit message branch.
- `app/api/business-managers/[bizId]/pages/grant-all/route.ts` —
  `maxDuration` 300 → 800 (the new 500ms per-request delay pushes a
  1000+-page BM's worst-case runtime close to the old 300s ceiling; matches
  the Vercel Pro max already used by the scan route, PR #711).
- `app/(dashboard)/business-managers/page.tsx` +
  `components/admin/business-managers/bm-dashboard.tsx` — wire the quota
  badge through as a prop.
- `lib/meta/__tests__/app-usage.test.ts` (new) — 9 tests: header parsing
  (well-formed, max-of-three, missing, malformed, non-numeric fields),
  retry-estimate heuristic (default, ≥100%, proportional, floor).
- `lib/bm/__tests__/grant-result.test.ts` (new) — 9 tests:
  `isFullGrantSuccess` (success / token-expired / failed / rate-limited-with-
  zero-failures) and `describeGrantResult` (rate-limit message shape,
  `totalTargeted` fallback, default retry estimate, token-expired
  precedence, plain success).

## Validation

- [x] `npm run build` — exit 0.
- [x] `npm test` — same 32 pre-existing failing assertions as `main`
      (verified via `git stash -u` before/after comparison), +18 new tests,
      all passing.
- [x] `ReadLints` on every touched file — clean.
- [ ] Manual smoke test — Matas to re-run "Grant all missing" on a BM that
      previously hit the rate limit; expect the run to halt after the first
      #4 error (not 200+ `sync_error` rows), a single `rate_limited` audit
      row, and the notice text to read "Granted X of Y — Meta rate limit
      hit, retry in ~N minutes."; confirm a second click after waiting
      resumes from where it left off.

## Notes

- Did not attempt a direct integration test of `grantPagesForBusinessManager`
  itself — same constraint as every other `lib/bm/grant.ts`-adjacent module
  this week (`server-only` + `lib/meta/client.ts`'s class parameter
  properties are incompatible with the `--experimental-strip-types` test
  runner). The two new pure-module test files give direct coverage of the
  algorithmic pieces (header parsing/estimation, result-shape helpers) that
  determine the halt/message behavior; the DB/Meta-call orchestration
  around them is unchanged in shape from the pre-existing, already-relied-
  upon early-return paths (token-expired, no-token-stored).
- Chose to reuse `isMetaAdAccountRateLimitError` (any of #4/#17/#80004)
  rather than hand-rolling a narrower "app-tier code 4 only" check per the
  literal ask — any of these quota errors warrants the same halt-and-back-off
  behavior in a mutation loop; retrying past ANY of them deepens that
  specific hole. The existing classifier already encodes Meta's exact
  message-matching heuristics and is unit-tested elsewhere.
