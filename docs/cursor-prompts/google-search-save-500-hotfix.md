# Cursor prompt [Cursor, Opus] — HOTFIX: PUT /api/google-search/[id] 500s

Copy this entire block into Cursor as a single message. Opus — production 500 on a live route, diagnose precisely then fix. This is blocking all wizard saves.

PREREQUISITE: Phases 1-4 + 3.5 + xlsx fixes + final-url/presence (#449) merged. Migration 096 applied.

---

## INCIDENT

Vercel anomaly alert: deployment `dpl_DU3E6AAvxoE4nWYYc46EWSfdhLxF` (the PR #449 merge) causes ALL `PUT /api/google-search/[id]` requests to fail with **500 uncaught exception**. "No application logs or external API failures detected — uncaught exception in the function code." Postgres logs are clean (no SQL-level rejection logged), confirming the throw is in the Node function layer, not a query Postgres rejected-and-logged.

Real user impact: Matas was editing a J2 plan in the wizard (trimming ~26 RSA descriptions over the 90-char limit), every autosave 500'd ("Save failed — retry from header"), and all edits were lost. This must be fixed before the wizard is usable.

## TIMELINE EVIDENCE

- Saves worked BEFORE #449 (the diff-aware save from #446 was fine).
- #449 added the `geo_targets` wrapper-object codec (`serializeGeoTargetsColumn` / `parseGeoTargetsColumn`) AND `geo_target_type`.
- 500s started with the #449 deployment.

So the regression is in #449's changes interacting with `saveGoogleSearchPlanTree` (`lib/db/google-search-plans.ts`) or the PUT route (`app/api/google-search/[id]/route.ts`).

## INVESTIGATE — find the exact throw

1. **Reproduce locally:** load the J2 plan tree (or any multi-campaign plan), simulate a PUT with a tree that mixes real-UUID rows and `tmp-` prefixed rows (newly-added rows the wizard hasn't persisted yet). Run `saveGoogleSearchPlanTree` against a test DB or a mocked supabase. Find what throws.

2. **Prime suspects (check each):**

   **(a) `tmp-` IDs reaching SQL as UUIDs.** `saveGoogleSearchPlanTree` builds `survivingCampaignIds` / `survivingAdGroupIds` arrays from `partitionTreeRows` updates + insert-resolved ids, then passes them to `.in("campaign_id", survivingCampaignIds)` / `.in("ad_group_id", survivingAdGroupIds)`. If ANY element is a `tmp-` string (e.g. an insert whose real id resolution failed, or `resolveCampaignId` returning the tmp id as fallback via `?? treeId`), Postgres rejects `tmp-foo` as invalid uuid input syntax → uncaught throw → 500. The `?? treeId` fallbacks in `resolveCampaignId` / `resolveAdGroupId` are the danger — they can leak a tmp id into a subsequent `.in()` or FK insert. AUDIT every place a resolved id flows into a query and ensure it's a real UUID, never a `tmp-` string.

   **(b) geo codec throw.** `serializeGeoTargetsColumn({ targets: tree.plan.geo_targets, geo_target_type: tree.plan.geo_target_type })` — if `tree.plan.geo_target_type` is undefined (older client state, or a tree loaded before #449's field existed) or `geo_targets` is an unexpected shape, does the codec throw? Read `lib/google-search/geo-targets-codec.ts`. Make both serialize + parse total functions: never throw on undefined/null/legacy/garbage input — coerce to `{ targets: [], geo_target_type: "PRESENCE" }` and move on.

   **(c) Function timeout.** The save does ~97 sequential awaited round-trips for the J2 plan (load existing ids + per-row update/insert across 5 levels). If the route has no `maxDuration`, a large plan can exceed the default and the platform kills it. Add `export const maxDuration = 60;` (or higher) to the route. Also consider: can the per-row updates within a level be batched? Not required for the hotfix, but note it.

3. The most likely single cause is **(a) — a `tmp-` id reaching a `.in()` or insert**. The mixed real/tmp tree from rapid editing is exactly the trigger. But verify with a repro rather than assuming.

## FIX

Whatever the repro shows, ship these defensive fixes (all of them — defense in depth on a money-adjacent route):

1. **Guard against `tmp-`/non-UUID ids reaching SQL.** Add a helper `isRealRowId(id): boolean` (UUID regex) and:
   - In `partitionTreeRows`, treat a row whose id is NOT a real UUID as an INSERT regardless of the `existing` set (a `tmp-` id can never be in `existing`, but make it explicit + defensive).
   - Before any `.in("...", ids)` call, filter `ids` to real UUIDs only. A `tmp-` id in a surviving-ids array is a bug; filtering it out prevents the Postgres uuid-syntax throw.
   - In `resolveCampaignId` / `resolveAdGroupId`, if resolution falls through to `?? treeId` AND `treeId` is a `tmp-` id, THROW a clear domain error ("unresolved tmp id for campaign X") rather than letting it silently flow into an FK insert. A clear 500 with a real message beats a cryptic uuid-syntax error — but ideally the resolution never falls through.

2. **Make the geo codec total.** `serializeGeoTargetsColumn` + `parseGeoTargetsColumn` must NEVER throw. Wrap in try/catch, default to `{ targets: [], geo_target_type: "PRESENCE" }` on any unexpected input. Add tests for: undefined geo_target_type, null geo_targets, legacy array, garbage object.

3. **Add `maxDuration` to the PUT route.** `export const maxDuration = 60;` in `app/api/google-search/[id]/route.ts`. Mirror whatever the rollup/heavy routes use.

4. **Surface the real error.** The PUT route already returns `{ ok: false, error: err.message }` on catch — good. But add a `console.error("[google-search PUT] save failed", { planId: id, error: ... })` so the next failure shows in Vercel logs (the alert said no app logs were captured — make sure THIS route logs its throws). The client's "Save failed — retry from header" should surface `err.message` so the operator sees the actual reason, not a generic message.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/db/google-search-plans.ts lib/google-search/ app/api/google-search/
node --experimental-strip-types --test 'lib/db/__tests__/google-search-plans-save.test.ts' 'lib/google-search/__tests__/geo-targets-codec.test.ts'
npm run build
```

Tests — the regression-proof ones:
- Save a tree with MIXED real-UUID + `tmp-` rows (new campaigns/ad groups/keywords added in the wizard) → assert no `tmp-` id ever reaches a `.in()` or insert FK; assert the save succeeds and tmp rows get real ids
- Save a tree whose `plan.geo_target_type` is undefined → no throw, defaults to PRESENCE
- Save a tree with legacy-array geo_targets (no wrapper) → no throw
- `partitionTreeRows`: a `tmp-` id is always an insert
- geo codec: serialize+parse round-trip is total over undefined/null/legacy/garbage
- Reproduce the J2-scale save (7 campaigns, 13 ad groups, 45 keywords, 9 RSAs, 23 negatives, with several rows edited) → succeeds

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-save-500-hotfix`
- Do NOT add a migration
- Do NOT regress the diff-aware idempotency from #446 (pushed_resource_name preservation) — the fix must keep UPDATE excluding pushed_resource_name
- Do NOT regress the geo_target_type / final_url features from #449 — make them robust, don't remove them
- The codec must be TOTAL (never throws)
- maxDuration added to the PUT route

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-save-500-hotfix.md`. PR title: `fix(creator): google-search PUT 500 — tmp-id guard + total geo codec + maxDuration`. Document the EXACT root cause found in the repro (which of (a)/(b)/(c) it was), not just the defensive fixes.

## URGENCY

This is a production 500 on a live route that caused real data loss. It's the top priority. Once merged + deployed, Matas re-imports the J2 plan fresh and the saves will hold. The over-90-char descriptions still need trimming (the xlsx char counts were wrong — real lengths exceed 90), but with saves working the trims will persist this time.
