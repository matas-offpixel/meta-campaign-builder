# Session log

## PR

- **Number:** 934
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/934
- **Branch:** `cursor/rules-match-the-objective`

## Summary

Four production purchase campaigns carry a registration or LPV ladder. Metric Priority is live off the current objective; the rule cards are frozen from whenever they were last generated. This PR gives every surface one helper for that disagreement, stamps `rulesObjective` so the wizard hole cannot hide it, and offers regenerate in every mode — including custom — without silently overwriting a hand-written ladder. The four live drafts are not rewritten.

## Scope / files

- `lib/optimisation-rules.ts` — `describeOptimisationRulesMismatch`, `inferRulesObjectiveFromRules`, exhaustive `generateRulesForObjective`
- `lib/types.ts` — optional `rulesObjective` on the strategy jsonb
- `lib/autosave.ts` — `migrateDraft` defaults the stamp from the primary metric
- `lib/optimisation/presets.ts` — `materialiseStrategy` stamps `preset.objective`
- `components/steps/campaign-setup.tsx` — wizard-only optional props; stamps on objective change, does not regenerate
- `components/wizard/wizard-shell.tsx` — passes strategy into Campaign Setup
- `components/steps/optimisation-strategy.tsx` — mismatch card + regenerate in every mode
- `lib/__tests__/optimisation-rules-mismatch.test.ts` — four prod fixtures, six objectives, throw-by-name
- Did not touch `components/plan/**`, `lib/optimisation/{evaluate,apply,gates}.ts`, or the four drafts

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5561 pass, 4 skipped)
- [x] no frame files touched, zero regenerated baselines. Local `frames:check` could not start the frames server (no Supabase env). CI is the authority on Darwin-vs-Ubuntu frame diffs.

## Notes

- `initiate_checkout` is already on `main` (#930). The helper and the exhaustive switch cover all six union members. Do not treat a seventh as registration.
- Awareness CPM £6–£8 matches no band. `evaluate.ts` already falls through to `maintain` (`no band matches` test). Harmless; do not widen the bands here.
- `engagementRules()` and `awarenessRules()` have no pause band. Product question for Matas.
- `ENABLE_OPTIMISATION_WRITES` is live and unchanged. No backfill.
