# Session log

## PR

- **Number:** 934
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/934
- **Branch:** `cursor/rules-match-the-objective`

## Summary

Four production purchase campaigns carry a registration or LPV ladder. Metric Priority is live off the current objective; the rule cards are frozen from whenever they were last generated. This PR gives every surface one helper for that disagreement, stamps `rulesObjective` only when the primary metric identifies exactly one objective, and offers regenerate in editor modes — including custom — without silently overwriting a hand-written or preset-owned ladder. The four live drafts are not rewritten.

Round 2: `cpa` no longer guesses `initiate_checkout` / `purchase`. The preset view no longer offers a benchmark regenerate. `migrateDraft` is invoked in a real fixture test.

## Scope / files

- `lib/optimisation-rules.ts` — `describeOptimisationRulesMismatch`, `inferRulesObjectiveFromRules` (null on a shared primary), exhaustive `generateRulesForObjective`, unknown-objective mismatch instead of a render throw
- `lib/types.ts` — optional `rulesObjective` on the strategy jsonb
- `lib/autosave.ts` — `migrateDraft` defaults the stamp from a uniquely identified primary
- `lib/optimisation/presets.ts` — `materialiseStrategy` stamps `preset.objective`
- `components/steps/campaign-setup.tsx` — wizard-only optional props; stamps on objective change, does not regenerate
- `components/wizard/wizard-shell.tsx` — passes strategy into Campaign Setup
- `components/steps/optimisation-strategy.tsx` — mismatch card; regenerate in editor modes; preset path points at `resolvePreset`
- `lib/__tests__/optimisation-rules-mismatch.test.ts` — prod copies as one case, DJ EZ, matching draft, migrateDraft fixtures, cpa-ambiguous null
- Did not touch `components/plan/**`, `lib/optimisation/{evaluate,apply,gates}.ts`, or the four drafts

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5563 pass, 4 skipped)
- [x] no frame files touched, zero regenerated baselines

## Notes

- `initiate_checkout` is already on `main` (#930). The helper and the exhaustive switch cover all six union members. Do not treat a seventh as registration.
- `initiateCheckoutRules()` is `purchaseRules()` with the labels changed — same `cpa` bands, same 3d window. #930's defect; this PR does not invent replacement numbers. `METRIC_LABELS.cpa` is still `"CPP"`.
- An off-union `settings.objective` is a named mismatch on the step, not a white screen. `generateRulesForObjective` still throws by name if something asks it to build a ladder.
- Preset path: do not offer Regenerate. A materialised preset owns its rules; the operator re-applies via `resolvePreset`. Clearing `preset` and writing benchmarks would orphan provenance the other way.
- Awareness CPM £6–£8 matches no band. `evaluate.ts` already falls through to `maintain`. Harmless; do not widen the bands here.
- `engagementRules()` and `awarenessRules()` have no pause band. Product question for Matas.
- `ENABLE_OPTIMISATION_WRITES` is live and unchanged. No backfill.
