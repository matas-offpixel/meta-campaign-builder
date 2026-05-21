# Session log — Google Search wizard data model + xlsx import (Phase 1)

## PR

- **Number:** 443
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/443
- **Branch:** `creator/google-search-wizard-data-model`

## Summary

Phase 1 of the Google Search Campaign Creator wizard build
(scope: `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`,
Phase 0 spike: PR #442). Lands the relational data model
(`google_search_plans` + 5 child tables) behind RLS, the typed
application shape, CRUD that loads/persists the full nested plan tree,
and the xlsx-import path that parses Matas's J2 Melodic spreadsheet
format straight into a plan tree.

The xlsx-import path is the time-compression win: an operator builds a
plan in xlsx (the format they already use), uploads it, and the wizard
in Phase 2 becomes a review-and-tweak surface over imported data
instead of a from-scratch data-entry form.

## Scope / files

- `supabase/migrations/096_google_search_plans.sql` — six tables
  (`google_search_plans`, `_campaigns`, `_ad_groups`, `_keywords`,
  `_negatives`, `_rsas`) with foreign-key cascades, indexes, an
  `updated_at` trigger on the plan, and per-user RLS via the join-up
  pattern from migration 077 (`tier_channel_allocations`). `for all`
  policies collapse select/insert/update/delete into one policy per
  table; `auth.role() = 'service_role'` bypass on every policy so
  Phase 3 server jobs work without a forged session.
- `lib/google-search/types.ts` — row types per table, composite
  `GoogleSearchPlanTree`, parser-output `*Draft*` variants, and a
  `GoogleSearchImportWarning` discriminated union the wizard can group
  by `code`. Lives outside `lib/types.ts` per the 4-thread invariant
  (Ops thread owns the root types file).
- `lib/db/google-search-plans.ts` — `createGoogleSearchPlan`,
  `loadGoogleSearchPlanTree`, `saveGoogleSearchPlanTree`,
  `createGoogleSearchPlanTreeFromDraft`, `listGoogleSearchPlansForEvent`,
  `deleteGoogleSearchPlan`. Uses an untyped `SupabaseClient` (no
  `Database` generic) because the new tables aren't in
  `lib/db/database.types.ts` yet — same pattern as
  `lib/cron/match-attribution.ts` after migration 094. A separate
  follow-up regen PR can type the tables once ops has applied 096.
- `lib/google-search/xlsx-import.ts` — `parseGoogleSearchPlanXlsx`
  plus `normaliseMatchType` and `classifyCharOverflow` exported for
  reuse. Tolerant of title rows, blank rows, header drift, bracketed
  match types (`[Exact]`, `"Phrase"`, `Broad Match`), and `30 ✓`
  char-count cells. Headlines/descriptions over the 30/90 limit are
  flagged in warnings but not dropped (the wizard surfaces fixes).
- `app/api/google-search/import/route.ts` — `POST` multipart endpoint
  that accepts the xlsx, parses, inserts under the authenticated
  user's id, returns `{ ok, plan_id, warnings, summary }`. 422 when
  zero campaigns parse (typically a structural mismatch in the
  Keywords tab).
- `lib/google-search/__tests__/xlsx-import.test.ts` — 12 tests covering
  match-type normalisation, char-overflow classification, and an
  in-memory end-to-end parse of a fixture mirroring the J2 structure
  (Overview / Keywords / Ad Copy / Negative Keywords tabs).

## Validation

- [x] `npx tsc --noEmit` — pre-existing 46 errors unchanged (verified
      by `git stash` parity); Phase 1 introduces 0 new errors.
- [x] `npx eslint lib/google-search/ lib/db/google-search-plans.ts app/api/google-search/` — clean.
- [x] `node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts'` — 12 / 12 pass.
- [x] `npm run build` — green; `/api/google-search/import` registered.

## Ops checklist (post-merge)

1. **Apply migration 096** via Supabase MCP. Six fresh tables; no
   backfill; safe to apply in any order relative to other 09x
   migrations. The migration ends with `notify pgrst, 'reload schema';`
   so PostgREST picks up the new tables without a service restart.
2. **Regenerate `lib/db/database.types.ts`** (separate small PR) so the
   CRUD module can move from `SupabaseClient` to `SupabaseClient<Database>`
   and get typed queries on the new tables. Until then the queries are
   typed at the application boundary only (the row types in
   `lib/google-search/types.ts`).
3. **No env-var changes.** Phase 1 reuses the existing Supabase config
   and the Google Ads OAuth artefacts from PR #182.

## Notes / follow-ups

- **Diff size.** Migration 281 + parser 485 + tests 202 = 968 lines on
  the migration-and-import surface (the prompt aimed for <600). The
  overrun is structural: child-table-of-grandparent RLS uses the
  3-level `IN (SELECT ag.id FROM ad_groups JOIN campaigns ON ... JOIN
  plans ON ...)` join, and each `for all` policy needs `using` +
  `with check` for the same expression. The parser is doc-heavy because
  the J2 xlsx format has five tab shapes that downstream readers (Phase
  2 wizard) will reference. Trimming docstrings to hit the budget
  would hurt Phase 2 onboarding more than the line count gains.
  Total addition (incl. types / CRUD / route): 1,785 lines. Open to
  splitting into "migration + CRUD" and "parser + route" PRs if the
  reviewer prefers — there are no cross-dependencies between the two
  halves at the file level.
- **`saveGoogleSearchPlanTree` is nuke-and-rewrite.** It updates the
  plan row in place, deletes all children (`ON DELETE CASCADE` drops
  the subtree in one statement), then re-inserts via the same path as
  the importer. This loses any `pushed_resource_name` values on
  existing rows — fine for Phase 1/2 (no push capability yet); Phase
  3 will replace this with a diff-aware writer that preserves push
  metadata + writes through `tiktok_write_idempotency`-style
  per-resource keys (see scope doc Phase 3 + spike session log §5).
- **Plan-scoped vs campaign-scoped negatives.** The parser routes any
  negative with scope `"all"` / `"plan"` / blank to plan-scope, and
  scopes matching a known campaign name to that campaign. Unknown
  campaign references fall back to plan-scope with a warning — better
  to over-share a negative than to silently drop it.
- **Phase 0 → Phase 1 linkage.** The `pushed_resource_name` column on
  every child table is the foothold for Phase 3: the push adapter
  fills it with the result of `client.mutate(creds, "campaigns" |
  "adGroups" | "adGroupCriteria" | "adGroupAds", ops)`. The Phase 0
  spike (PR #442) proved every one of those endpoints works on Basic
  Access from this app's existing OAuth contract — the schema here is
  intentionally shaped so each row maps 1:1 to a single mutate op in
  the push chain.

### Shared-file edits surfaced for ops batch

None. Phase 1 is fully additive: a new migration, a new `lib/google-search/`
subtree, a new `lib/db/google-search-plans.ts` module, and a new
`app/api/google-search/import/` route. No edits to `lib/types.ts`,
`lib/supabase/**`, `components/ui/**`, `proxy.ts`, or any other
shared-file path. `lib/db/database.types.ts` is intentionally NOT
regenerated in this PR (see ops checklist item 2).
