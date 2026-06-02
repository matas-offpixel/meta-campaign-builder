# Cursor prompt [Cursor, Opus] — fix Google Ads plans list showing empty

Copy this entire block into Cursor as a single message. Opus — silent empty-list bug; diagnose precisely, the obvious query looks correct so it's subtler.

PREREQUISITE: Phases 1-4 + 3.5 + #448-#453 merged. Migrations 096 + 097 applied.

---

## BUG

The Google Ads plans list page at `app.offpixel.co.uk/google-ads` shows **"No Google Ads plans yet"** even though two plans exist in `google_search_plans` for the logged-in user.

Confirmed via direct DB query — these two rows exist:
- `a4985d5b-d4a8-40c5-aecb-9e9123ff504f` — status `pushed`, structure_mode `single_campaign`
- `6ffef725-6313-45b2-a915-a9a18cef0fc2` — status `draft`, structure_mode `single_campaign`

Both have:
- `user_id = 'b3ee4e5c-44e6-4684-acf6-efefbecd5858'` (= matas@offpixel.co.uk, the logged-in user — verified in auth.users)
- `event_id = '42b5673a-aef4-402d-8855-9ca5339046a7'`
- `google_ads_account_id = '95c7bf96-...'` (LWE)

Migration 096 (table + RLS) and 097 (structure_mode) are both applied to production. RLS policy `google_search_plans_owner` allows `auth.uid() = user_id`. Hard-refresh does NOT fix it (so not a stale tab).

So: right user, RLS permits, rows exist, schema current — yet the list renders empty. The bug is in the list page's query or render.

## ROUTE CONFUSION TO RESOLVE FIRST

The URL is `/google-ads` but the wizard routes were built under `/google-search` (per the Phase 2 PR). There may be TWO pages:
- `app/(dashboard)/google-search/page.tsx` — the index built in Phase 2
- something serving `/google-ads` — possibly an OLDER page, or a redirect, or a different component

**Step 1: figure out which page actually renders at `/google-ads`.** Grep the routes. If `/google-ads` is a separate/older page that queries a different (or wrong) source, that's the bug — the nav links to `/google-ads` but the working index is at `/google-search` (or vice versa). Check `components/` nav/sidebar for the "Google Ads" link target.

## INVESTIGATE

1. **Which file renders `/google-ads`?** Is it the same page as `/google-search`, a redirect, or a distinct (stale) page? The left-nav "Google Ads" link — where does it point?

2. **The query on whatever page renders `/google-ads`.** Quote it. Does it:
   - Query `google_search_plans` (correct) or some other/older table?
   - Filter `.eq("user_id", user.id)` correctly?
   - Have an extra filter that excludes these rows (e.g. `event_id IS NULL`, a status filter, a join to a table that returns nothing)?
   - Use the right Supabase client (server client with the user session, not an unauthed/service client that RLS would block, or a client where `auth.uid()` is null → RLS returns nothing)?

3. **Auth context.** If the page uses a Supabase client where the session isn't attached, `auth.uid()` is null, RLS returns zero rows, and `.eq("user_id", ...)` matches nothing. Verify the page uses `createClient()` (server, session-bound) the same way the working `loadGoogleSearchPlanTree` path does.

4. **Render layer.** If the query DOES return the 2 rows but the UI shows empty, it's a render bug (wrong prop, the list maps over the wrong array, an early-return on a loading/error state). Check the component renders `plans.length > 0`.

## LIKELY ROOT CAUSE (rank by probability)

1. **`/google-ads` is a different page than `/google-search`** — the nav points to a stale/placeholder `/google-ads` route that was never wired to the real query, while the functional index lives at `/google-search`. Fix: point the nav to the working route, or make `/google-ads` render the same index component + query.
2. **Auth/client mismatch** — the page uses a client where `auth.uid()` is null → RLS empties the result.
3. **Over-restrictive filter** — an extra `.eq()` or join excludes the rows.

## FIX

Whatever the diagnosis: make `/google-ads` (the URL the nav uses) render the working plans index that queries `google_search_plans` scoped to the authenticated user via the session-bound server client, showing all their plans (pushed + draft) newest-first. If there are two divergent pages, consolidate to one (delete the stale one, or redirect). Don't leave two list pages.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint app/ components/google-search-wizard/ lib/db/google-search-plans.ts
node --experimental-strip-types --test 'lib/db/__tests__/*.test.ts'
npm run build
```

Test:
- A `listGoogleSearchPlansForUser(supabase, userId)` function exists + is what the index uses (add it to `lib/db/google-search-plans.ts` if the index was doing an inline query — centralise it). Returns all the user's plans newest-first.
- The list page renders rows when plans exist (component test with a mocked non-empty result).

Manual: `app.offpixel.co.uk/google-ads` → shows the 2 J2 plans (pushed + draft), each with Open-wizard action.

## NON-NEGOTIABLES

- Branch: exactly `creator/fix-google-ads-plans-list-empty`
- Use the session-bound server client (`createClient()`) so RLS sees `auth.uid()` — this is likely the crux
- One canonical plans-list page (no divergent `/google-ads` vs `/google-search`)
- Don't regress the wizard, push, geo, or structure-mode work
- No migration

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-fix-google-ads-plans-list-empty.md`. PR title: `fix(creator): Google Ads plans list empty — [actual root cause]`. State which of the 3 causes it was.

## AFTER MERGE

Matas opens `/google-ads` → sees the 2 J2 plans. Can re-open the pushed single-campaign plan to re-push or the draft to edit.
