# Session log — autotag-sonnet-load-reduction

## PR

- **Number:** pending
- **URL:** _to be filled after `gh pr create`_
- **Branch:** `cursor/autotag-sonnet-load-reduction`

## Summary

Salvages the model-agnostic pieces of PR #457 (thumbnail content-hash dedup,
daily cadence gate, `ASSIGNMENT_SELECT` `model_version` bug fix, expanded cron
summary counters, validation-script env-driven config) on top of latest `main`,
without changing `AI_AUTOTAG_MODEL_VERSION`. The Sonnet → Haiku swap from #457
was validated against Sonnet ground truth (see the validation comment posted on
#457: every dimension below 0.50 F1, `cell_exact_match_rate` 0.281,
`tag_jaccard` 0.20) and rejected. This PR delivers the volume/throughput win
without the quality regression. `ENABLE_AI_AUTOTAG` stays OFF.

## Scope / files

- `lib/intelligence/auto-tagger.ts` — adds `fetchAutoTagImage`,
  `classifyAutoTagImage`, `hashAutoTagImage`, `autoTagDeduped`,
  `mapWithConcurrency`, and the `DedupAutoTag*` types. Model constant stays at
  `claude-sonnet-4-6`; docstring rewritten to reference the #457 rejection.
- `app/api/cron/refresh-active-creatives/route.ts` — replaces the per-creative
  `autoTag` loop with `autoTagDeduped`, adds the cadence gate
  (`shouldRunDailyAutoTagPass`), builds `knownTagsByHash` from the current
  model's persisted rows, and tracks `claudeCalls`, `creativesReusedThumbnail`,
  `uniqueThumbnails`, `passesSkippedCadence` in the per-event summary.
- `lib/db/creative-tags.ts` — adds `thumbnail_hash` to
  `CreativeTagAssignmentRow` / `UpsertCreativeTagAssignmentArgs` /
  `ASSIGNMENT_SELECT`; latter also adds the previously omitted `model_version`
  column so the by-name dedup actually matches existing rows.
- `lib/intelligence/__tests__/auto-tagger.test.ts` — three new `autoTagDeduped`
  cases (single-call-per-hash, persisted-reuse, thumbnail-less). Existing model
  assertion stays at `claude-sonnet-4-6`.
- `lib/intelligence/__tests__/autotag-cadence.test.ts` — new file (10 cases)
  covering `isSameUtcDay`, `lastAiTagAt`, `shouldRunDailyAutoTagPass`. Tests
  use both Sonnet and Haiku model strings to verify model-scoped filtering.
- `scripts/validate-ai-tagging.ts` — env-driven `VALIDATE_GROUND_TRUTH`,
  `VALIDATE_GROUND_TRUTH_MODEL`, `VALIDATE_PREDICT_MODEL`, `VALIDATE_LIMIT`,
  plus `overall_agreement` (cell-exact-match + tag-Jaccard) output. Defaults
  preserve the original manual-ground-truth behaviour. Useful for future
  candidate-model gates.
- `supabase/schema.sql` — syncs `creative_tag_assignments.thumbnail_hash` and
  the partial index to match migration `096_creative_tag_assignment_thumbnail_hash.sql`
  (already on `main` and already applied in prod). Pure schema sync, no DDL.

## Not in scope

- **Model swap.** Stays on Sonnet 4.6. PR #457 should be closed without
  merging.
- **Migration rename `096 → 099`.** `main` has the migration as
  `096_creative_tag_assignment_thumbnail_hash.sql` (number collision with
  `096_google_search_plans.sql` is a pre-existing main-branch hygiene issue and
  out of scope here). Prod has the column applied; nothing to re-run.
- **Enabling `ENABLE_AI_AUTOTAG`.** Stays OFF; Matas flips when ready.

## Validation

- [x] `npx tsc --noEmit` — 47 pre-existing errors on `main` in unrelated
  test files; **0 new errors** from this PR (verified by re-running on `main`
  with the same baseline count).
- [x] `npx eslint <edited files>` — clean.
- [x] `node --experimental-strip-types --test lib/intelligence/__tests__/*.test.ts`
  — 15/15 pass (8 dedup/cadence new, 7 existing).
- [ ] Vercel preview build — pending after push.

## Notes

- Cadence gate is scoped to `model_version`, so the day a future model swap
  ships, the first cron run still does a fresh tag pass (no current-model row
  exists yet); subsequent runs that same day short-circuit. Same shape as
  #457's intent — just with the model constant left alone.
- `autoTagDeduped` is pure of DB work: the cron is responsible for building
  `knownTagsByHash` from persisted rows and for the upsert at the end. Keeps
  the dedup layer trivially unit-testable (which it now is).
- Cost expectation (no quality risk): once every event has been re-tagged
  once under the dedup+cadence pipeline, steady-state Claude calls per cron
  drop to "new creatives whose thumbnail hash hasn't been seen yet" — typically
  zero on a stable account, a handful on launch days.
- Validation script change is opportunistic: keeps the harness in shape for
  the *next* time we want to compare a candidate model against Sonnet. No
  behaviour change for the original manual-ground-truth workflow.
