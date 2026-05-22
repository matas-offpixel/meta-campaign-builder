# Cursor prompt [Cursor, Opus] — Phase 3.5: fix save-after-push idempotency hole

Copy this entire block into Cursor as a single message. Opus — this is a correctness bug with real-money consequences (duplicate live campaigns). Get it right.

PREREQUISITE: Phases 1-3 merged (PRs #443, #444, #445). Migration 096 applied.

---

## THE BUG (real-money severity)

`saveGoogleSearchPlanTree` in `lib/db/google-search-plans.ts` is nuke-and-rewrite: it `.delete()`s all campaigns for a plan (cascade drops ad groups / keywords / RSAs / negatives), then re-inserts everything fresh via `createGoogleSearchPlanTreeFromDraft`. The re-inserted rows:
- Get BRAND NEW UUIDs
- Have NULL `pushed_resource_name` (the draft type doesn't carry it)

The Phase 3 push adapter (`lib/google-ads/campaign-writer.ts`) uses `pushed_resource_name` as its idempotency signal — a row with a non-null `pushed_resource_name` is treated as already-created and skipped.

**The failure sequence:**
1. User pushes plan → campaigns created live in Google Ads, `pushed_resource_name` written to rows
2. Wizard autosaves (1500ms debounce) after ANY edit → entire subtree deleted + recreated with fresh NULL-`pushed_resource_name` rows
3. User pushes again → adapter sees no push markers → **creates DUPLICATE campaigns on the client's live Google Ads account**

This must be fixed before the wizard is used for any real push. Duplicate campaigns spending real money on a client account is the worst-case outcome.

## THE FIX — diff-aware save that preserves push metadata + stable IDs

Rewrite `saveGoogleSearchPlanTree` to be diff-aware instead of nuke-and-rewrite. Requirements:

1. **Preserve `pushed_resource_name`** on every row that already has one. A push marker must survive autosave.
2. **Preserve row UUIDs** for unchanged rows. The wizard already relies on real UUIDs replacing `tmp-` ids after save (per Phase 2 session log) — keep IDs stable so push metadata stays attached to the right entity.
3. **Handle the full set of edit operations:** rows added (insert), rows removed (delete), rows changed (update), rows unchanged (no-op).

### Recommended approach: ID-based reconciliation

The wizard's working tree carries row IDs (real UUIDs for persisted rows, `tmp-` prefixed for new ones). Use these to diff against the DB:

- **For each level (campaigns, ad_groups, keywords, negatives, rsas):**
  - Rows in tree with a real UUID that exists in DB → UPDATE (preserve `pushed_resource_name` — do NOT overwrite it with null; either omit it from the update payload entirely, or carry it through from the tree if the tree has it)
  - Rows in tree with `tmp-` ID (or no ID) → INSERT (new `pushed_resource_name` stays null, correct — they haven't been pushed)
  - Rows in DB whose ID is absent from the tree → DELETE (genuinely removed by the user)

- **Critical:** the UPDATE path must NEVER null out `pushed_resource_name`. Easiest: don't include `pushed_resource_name` in the update SET clause at all, so the DB keeps its existing value. The push adapter is the only writer of that column.

### The tree types need pushed_resource_name visible

Check `lib/google-search/types.ts`: do the node types (`GoogleSearchCampaignNode` etc) carry `pushed_resource_name`? They should (they spread the row type). The wizard loads it via `loadGoogleSearchPlanTree`. Confirm it round-trips: load → edit → save preserves it. If the wizard's client-side tree strips it, fix the load/save to retain it.

### Alternative if ID-reconciliation is too complex

If diff-by-ID proves fiddly across 5 levels, the simpler-but-acceptable fallback:
- Keep nuke-and-rewrite for the SUBTREE STRUCTURE, but FIRST snapshot all existing `(stable_key → pushed_resource_name)` mappings, then re-apply them after rewrite by matching on a stable natural key (campaign name, ad group name, keyword text + match type). This is more fragile (rename breaks the match) but simpler. PREFER the ID-based approach; only fall back to this if ID-reconciliation balloons the diff.

### Guard the push route too (defense in depth)

In `app/api/google-search/[id]/push/route.ts`, before pushing, if `plan.status === 'pushed'` and the tree still has rows with `pushed_resource_name` set, require an explicit `force` flag in the request body to re-push, OR only push rows where `pushed_resource_name IS NULL`. The adapter already does the latter per-row, but add a route-level guard so a double-click or stale-tab re-push can't slip through. Surface a clear message: "This plan was already pushed. N campaigns are live. Pushing again will only create newly-added campaigns."

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/db/ lib/google-search/ app/api/google-search/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/db/__tests__/*.test.ts'
npm run build
```

Tests (the bug-proof ones — these are the point of this PR):
- Save preserves `pushed_resource_name`: load a tree with a pushed campaign → edit an unrelated field → save → reload → assert the pushed campaign STILL has its `pushed_resource_name` and the SAME id
- Save handles add: add a new campaign (tmp- id) → save → assert it's inserted with null push marker, others unchanged
- Save handles remove: remove a campaign → save → assert it's deleted, others' push markers intact
- Re-push idempotency end-to-end: push (markers set) → autosave → push again → assert NO duplicate mutate calls for already-pushed rows (use the fake GoogleAdsClient from the Phase 3 tests)
- Route guard: re-push of a fully-pushed plan without force → returns the "already pushed" message, no mutates

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-save-idempotency-fix`
- Do NOT change the Phase 3 adapter's per-row idempotency logic — it's correct; the bug is the save path defeating it
- Do NOT add a migration if avoidable (the columns exist; this is a write-logic fix). If you genuinely need a `google_search_write_idempotency` table, claim migration 097 and surface for ops apply — but ID-based save reconciliation should NOT need it.
- The UPDATE path must never write null to `pushed_resource_name`
- Do NOT regress the xlsx-import path (`createGoogleSearchPlanTreeFromDraft` stays as-is for fresh inserts; only `saveGoogleSearchPlanTree` changes)

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-save-idempotency-fix.md`. PR title: `fix(creator): preserve push metadata across wizard autosave (Phase 3.5)`. Document the chosen reconciliation approach + the route guard.

## WHY THIS BLOCKS REAL USE

The wizard cannot be used for a real client push until this lands. Phase 4 (reporting) doesn't depend on it, but the first real push to a client account would risk duplicates the moment the user edits-after-pushing. This is the gate between "built" and "safe to use."
