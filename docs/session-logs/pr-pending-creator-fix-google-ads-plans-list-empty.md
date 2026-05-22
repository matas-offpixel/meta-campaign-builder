# Session log — Google Ads plans list empty

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/fix-google-ads-plans-list-empty`

## Summary

Fixed the `/google-ads` plans list page rendering "No Google Ads plans yet" even when
plans exist. Root cause: **stale Phase 0 skeleton** at
`app/(dashboard)/google-ads/page.tsx` — it hardcoded the empty state and never
queried the database. The real, working index was at `app/(dashboard)/google-search/page.tsx`
but the left-nav "Google Ads" link pointed to `/google-ads`. The fix:

1. Replaced the skeleton at `/google-ads` with a proper server-fetched list using
   the session-bound Supabase client (`createClient()`), so RLS (`auth.uid() = user_id`)
   is satisfied.
2. Added `listGoogleSearchPlansForUser(supabase, userId)` to `lib/db/google-search-plans.ts`
   as the canonical DB helper (centralises the query, used by the index page).
3. Replaced `app/(dashboard)/google-search/page.tsx` with a redirect to `/google-ads`
   to eliminate the divergent stale page — now one canonical list.
4. Fixed `hydratePlan` to explicitly normalise `structure_mode` (fallback to
   `single_campaign` for NULL / unknown values) — the spread `...(raw)` put `null`
   straight through before this fix.
5. Added `structure_mode` field to `GoogleSearchPlan` (types.ts), `CreatePlanInput`,
   `createGoogleSearchPlan` insert, and `saveGoogleSearchPlanTree` update — these were
   missing from the merged main (PR #453 was not yet merged when this branch was cut).

Root cause category: **divergent stale page** (option 1 from the three hypotheses).
The auth client would have been fine once the real page was wired; RLS was never tested
against the skeleton.

## Scope / files

- `app/(dashboard)/google-ads/page.tsx` — replaced skeleton with real server-fetched list
- `app/(dashboard)/google-search/page.tsx` — replaced with `redirect("/google-ads")`
- `lib/db/google-search-plans.ts` — added `listGoogleSearchPlansForUser`; fixed
  `hydratePlan` structure_mode fallback; added `structure_mode` to `CreatePlanInput`,
  `createGoogleSearchPlan`, `saveGoogleSearchPlanTree`, `createGoogleSearchPlanTreeFromDraft`
- `lib/google-search/types.ts` — added `STRUCTURE_MODES`, `DEFAULT_STRUCTURE_MODE`,
  `GoogleSearchStructureMode`; added `structure_mode` field to `GoogleSearchPlan`
- `lib/google-search/xlsx-import.ts` — added `structure_mode: DEFAULT_STRUCTURE_MODE`
  to the draft plan object (needed once structure_mode became required)
- `lib/db/__tests__/google-search-plans-list.test.ts` — new (5 tests covering
  user-scoped list, cross-user isolation, structure_mode hydration, fallback)

## Validation

- [x] `npx tsc --noEmit` — clean
- [x] `npm run build` — clean
- [x] `node --experimental-strip-types --test 'lib/db/__tests__/*.test.ts'` — 254/255 pass (1 skipped, 0 fail)

## Notes

- PR #453 (single-campaign structure mode) had not yet merged when this branch was cut
  from main. This PR includes the forward-compatible type additions (`structure_mode`)
  needed by `hydratePlan`. When #453 merges on top, any duplicate additions should be
  a clean no-op (additive-only).
- Nav link (`components/dashboard/dashboard-nav.tsx` line 99) already points to
  `/google-ads` — no change required.
- The wizard remains at `/google-search/[id]` — existing bookmarks / "Open wizard"
  buttons are unaffected.
