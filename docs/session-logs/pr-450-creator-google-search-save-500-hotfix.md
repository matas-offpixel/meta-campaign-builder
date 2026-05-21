# Session log: google-search PUT 500 hotfix

## PR

- **Number:** 450
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/450
- **Branch:** `creator/google-search-save-500-hotfix`

## Summary

Production 500 on `PUT /api/google-search/[id]` — every autosave in the Google
Search wizard 500'd after PR #449 deployed. Matas lost all edits on the J2 plan
(trimming 26 RSA descriptions over 90 chars). Three defensive fixes ship together
(defense-in-depth on a money-adjacent route): geo codec hardened to a total
function, `tmp-` id guard added across the save path, and `maxDuration = 60`
added to the route.

## Root cause

**Suspect (b) confirmed as the trigger: `normaliseTargets` is not iterable-safe.**

`serializeGeoTargetsColumn` calls `normaliseTargets(decoded.targets)`. Before
this PR, `normaliseTargets` was typed as `(raw: unknown[])` and used
`for (const entry of raw)` — which throws `TypeError: … is not iterable` when
`raw` is `null` or `undefined` at runtime.

`decoded.targets` is `tree.plan.geo_targets` from the PUT body. The TypeScript
type says `GoogleSearchGeoTarget[]`, but the route does no runtime validation of
`body.tree` beyond parsing JSON. A stale client-side React state (wizard opened
before #449 deployed, autosave fires after the new serverless function is live),
or any path that sends a partial tree without `geo_targets`, produces `undefined`
at runtime — which hit the un-guarded iterator and threw synchronously inside the
async function.

Because the route had no `console.error`, Vercel saw a 500 with zero app logs
and surfaced it as "uncaught exception" — the throw WAS caught by the
try/catch, but nothing was logged before the 500 JSON response.

Suspects (a) and (c) addressed defensively:
- (a) `tmp-` ids reaching SQL: real guard added (`isRealRowId`, filter on
  `survivingCampaignIds` / `survivingAdGroupIds`, explicit throw in
  `resolveCampaignId` / `resolveAdGroupId` for unresolved tmp- strings).
- (c) Timeout: `export const maxDuration = 60` added to the PUT route.

## Files changed

- `lib/google-search/geo-targets-codec.ts` — `normaliseTargets` accepts `unknown`
  (not `unknown[]`) and returns `[]` for non-array inputs. `serializeGeoTargetsColumn`
  validates `geo_target_type` at runtime, defaults to `"PRESENCE"` when invalid.
  Both functions are now total.
- `lib/db/google-search-plans.ts` — `isRealRowId(id)` UUID-regex helper
  (exported). `partitionTreeRows` uses `isRealRowId` to force non-UUID ids to
  INSERT. `survivingCampaignIds` / `survivingAdGroupIds` filtered through
  `isRealRowId`. `resolveCampaignId` / `resolveAdGroupId` throw a clear domain
  error if a `tmp-` id can't be resolved to a real UUID (should be unreachable —
  the insert step above throws on failure — but explicit > silent corruption).
- `app/api/google-search/[id]/route.ts` — `export const maxDuration = 60`.
  `console.error("[google-search PUT] save failed", ...)` in the catch block so
  the next failure is visible in Vercel logs.
- `lib/google-search/__tests__/geo-targets-codec.test.ts` — 5 new totality tests
  for `serializeGeoTargetsColumn` (undefined targets, null targets, undefined
  geo_target_type, unrecognised geo_target_type, entire decoded null).
- `lib/db/__tests__/google-search-plans-save.test.ts` — migrated all fixture IDs
  to UUID format (so `isRealRowId` treats them as existing rows, mirroring
  production). Added `isRealRowId` unit tests, `partitionTreeRows` tmp-id guard
  test, and 5 new "500 hotfix" regression tests (save with undefined/null
  `geo_targets`, save with mixed real+tmp tree, no tmp- id in `.in()` filters,
  survivingAdGroupIds contains only real UUIDs).

## Validation

- [x] `npx tsc --noEmit` — zero errors in changed files
- [x] `npx eslint lib/db/google-search-plans.ts lib/google-search/geo-targets-codec.ts app/api/google-search/[id]/route.ts ...tests...` — clean
- [x] `node --experimental-strip-types --test lib/db/__tests__/google-search-plans-save.test.ts lib/google-search/__tests__/geo-targets-codec.test.ts` — **34/34 pass** (up from 16)
- [x] `npm run build` — clean

## Notes

- The idempotency invariant from PR #446 is fully preserved: the UPDATE path
  still never writes `pushed_resource_name`. The new `isRealRowId` guard does
  not affect updates of real-UUID rows.
- The geo_target_type / final_url features from PR #449 are preserved — the
  codec is now robust rather than removed.
- After this deploys: Matas should re-import J2 fresh (xlsx import path) to get
  a clean plan tree, then trim the over-90-char descriptions before pushing.
  With saves working the edits will persist.
- Follow-up (not urgent): batch the per-row UPDATE queries within each level
  (currently ~100 sequential round-trips for J2). For now `maxDuration = 60`
  is the pragmatic guard.
