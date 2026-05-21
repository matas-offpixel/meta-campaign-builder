# Session log — Phase 3.5 save-idempotency fix

## PR

- **Number:** 446
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/446
- **Branch:** `creator/google-search-save-idempotency-fix`

## Summary

Phase 3.5 of the Google Search Campaign Creator. Fixes the
real-money-severity bug introduced by Phase 2's nuke-and-rewrite
autosave: every wizard edit was wiping `pushed_resource_name` off every
row, silently defeating the Phase 3 push adapter's per-row idempotency
check. The first push would create campaigns live on Google Ads; the
second push (after any edit) would duplicate them.

Three changes:

1. **`saveGoogleSearchPlanTree` is now diff-aware.** ID-based
   reconciliation against the rows currently in Postgres — UPDATE for
   tree rows present in DB, INSERT for tree rows with an unknown id
   (tmp- prefixed or otherwise), DELETE for DB rows absent from the
   tree. The UPDATE path **never writes `pushed_resource_name`** (the
   push adapter is the sole owner of that column). The plan-level
   UPDATE also drops `status` and `pushed_at` for the same reason.
2. **Push-route guard.** `POST /api/google-search/[id]/push` refuses
   to launch when `plan.status === 'pushed'` OR any campaign carries a
   `pushed_resource_name`, unless the request body includes
   `{ force: true }`. Defence in depth against double-clicks and
   stale-tab re-fires.
3. **Wizard re-push UX.** The "Push again" button (and the new
   refused-by-guard branch) sends `{ force: true }` automatically so
   the operator opts in deliberately. Labels updated.

## Reconciliation approach (chosen)

ID-based reconciliation, not natural-key fallback. Each of the five
child levels (campaigns → ad groups → keywords / RSAs → negatives)
queries the existing ids for the plan, partitions the incoming tree
rows into `{ updates, inserts, deletes }` via a small pure helper
`partitionTreeRows`, then issues per-row UPDATEs (preserving
`pushed_resource_name` by omitting it from the SET clause), batched
INSERTs, and `.in('id', […])` DELETEs. Cascade FKs on the schema
handle removed-children automatically. New tmp-id rows mint real
UUIDs on insert; a tmp→real map resolves child FKs in the next
level.

Why not natural-key fallback: tree edits often _rename_ rows (campaign
name, keyword text), and a rename-on-pushed-row would silently break
the idempotency mapping. ID-based stays correct under any edit.

Why no new migration: `pushed_resource_name` columns are already on
every relevant table (migration 096). The bug is a write-logic bug
not a schema gap.

## Scope / files

- `lib/db/google-search-plans.ts` — `saveGoogleSearchPlanTree`
  rewritten diff-aware + `partitionTreeRows` helper exported.
- `lib/google-search/push-guard.ts` — new pure helper for the route
  guard.
- `app/api/google-search/[id]/push/route.ts` — wires the guard; reads
  `{ force?: boolean }` from the body; returns HTTP 409 with
  `reason: "already_pushed"` when refused.
- `components/google-search-wizard/steps/push.tsx` — sends `force`
  on the "Push again" branches; renders the `already_pushed` refusal.
- `lib/db/__tests__/_google-search-memory-supabase.ts` — new in-memory
  Supabase shim (covers exactly the chain shapes the save uses).
- `lib/db/__tests__/google-search-plans-save.test.ts` — bug-proof
  save tests (11 cases).
- `lib/google-search/__tests__/push-guard.test.ts` — guard unit tests
  (6 cases).
- `lib/google-ads/__tests__/repush-idempotency.test.ts` — end-to-end
  push → autosave → re-push (asserts ZERO mutate calls on round 2).

## Validation

- [x] `npx tsc --noEmit` — 46 errors (baseline = 47; net −1).
- [x] `npx eslint lib/db/ lib/google-search/ lib/google-ads/ app/api/google-search/ components/google-search-wizard/`
  — 0 errors, 24 warnings (all pre-existing `_unused-vars` in
  unrelated files).
- [x] `node --experimental-strip-types --test` on the new test files
  + Phase 3 adapter tests — 33/33 pass.
- [x] `npm run build` — succeeded, no client/server bundling issues.

## Notes

- **No migration needed.** Phase 1's `pushed_resource_name` columns
  are sufficient. Marker preservation is purely a write-logic
  concern.
- **xlsx-import path untouched.** `createGoogleSearchPlanTreeFromDraft`
  still nukes nothing (it's an INSERT-only path); only the
  wizard-autosave path is diff-aware.
- **No regression risk on the Phase 3 adapter.** Per-row idempotency
  inside `pushGoogleSearchPlan` is unchanged. The end-to-end test
  proves the round-trip now works.
- **Future cleanup (low priority).** The diff-aware save issues one
  UPDATE per row even when no field changed; this is correct but
  wastier than necessary. A field-level diff (skip-noop) could halve
  the autosave write count once the plans get big. Out of scope for
  the real-money fix.
