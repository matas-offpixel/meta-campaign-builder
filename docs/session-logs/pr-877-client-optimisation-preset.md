# Session log — client optimisation presets (PR 2 of 7, campaign creator redesign)

## PR

- **Number:** 877
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/877
- **Branch:** `cursor/client-optimisation-preset`

## Summary

Of the 14 questions wizard step 2 asks per campaign, exactly one belongs to
the campaign — the target. The other 13 (mode, metric, window, five ladder
bands, action percents, six guardrails) are client policy, re-asked from
scratch on every campaign. This PR gives them a home: a preset per
CLIENT × OBJECTIVE, stored with ladder bands as **multipliers of the target**
so one preset fits any budget, and **materialised** into
`campaign_drafts.draft_json->optimisationStrategy` at draft creation / plan
prepare. The optimisation tick is untouched — it reads the campaign's own
copy exactly as it did before, so editing a preset can never change a
running campaign's behaviour.

Migration 165 is a file only; it is applied to prod manually before merge.

## Scope / files

**Schema (file only, not applied)**
- `supabase/migrations/165_client_optimisation_presets.sql` — `client_optimisation_presets`
  (`UNIQUE (client_id, objective)`, per-user RLS on the `campaign_drafts`
  pattern) + `campaign_plans.target_value` / `target_unit` (zone D, rendered
  by PR 3).

**Pure logic**
- `lib/optimisation/presets.ts` — `resolvePreset` (client preset →
  `generateRulesForObjective` "industry seed"), `materialiseStrategy`,
  `ruleToPresetRule`, and the step-2 read helpers (`presetStepView`,
  `currentTarget`, `applyTargetToStrategy`).
- `lib/plan/target-unit.ts` — the one unit → objective / optimisation goal /
  ladder metric table.
- `lib/optimisation/preset-backfill.ts` — the backfill planner, split out so
  the dry run is testable without a database.
- `lib/optimisation-rules.ts` — exported `roundThresholdValue` /
  `formatThresholdValue` so preset scaling produces bands byte-identical to
  `regenerateThresholdsFromTarget` (guard test asserts it).

**Persistence + API**
- `lib/db/optimisation-presets.ts` — read/save/delete, defensive jsonb
  parsing, additive-safe when 165 is unapplied.
- `app/api/clients/[id]/optimisation-presets/route.ts` — GET / PUT with
  ownership checks.

**UI**
- `components/dashboard/clients/optimisation-presets-panel.tsx` — one card
  per objective in use (+ add), `ThresholdBand` ladder, `MetricChip`
  guardrails, `ProvenanceBadge`, `StatusDot` default arm, advanced
  guardrails behind a disclosure. Kit only; no `<p>`, no `CardDescription`.
- `app/(dashboard)/clients/[id]/page.tsx`, `components/dashboard/clients/client-detail.tsx`
  — new "Optimisation" tab.
- `components/steps/optimisation-strategy.tsx` — preset-linked drafts get a
  read-only view with one editable field (the target); drafts without a
  preset behave exactly as today. The full editor stays until PR 7.
- `components/wizard/wizard-shell.tsx` — one line, passes `clientId` through
  for the badge's edit link.

**Plan wiring**
- `lib/plan/{types,persist,empty-plan}.ts` — `CampaignPlanTarget` on the
  intent, read/written defensively so an unapplied 165 cannot break saves.
- `lib/plan/prepare-draft.ts` — `applyOptimisationPreset`, the one place a
  preset becomes a strategy.
- `app/api/plan/[id]/prepare-draft/route.ts` — loads the client's presets.

**Ops**
- `scripts/backfill-optimisation-presets.mjs` — dry run by default, `--apply`
  to write, `--client=<uuid>` to scope. Never overwrites an existing preset;
  every row written `default_arm = 'off'`.

## Validation

- [x] `npx tsc --noEmit` — no new errors in non-test source; the two test-file
  errors this PR introduced (a missing `PresetRule.name`) are fixed. Remaining
  test-file errors are pre-existing (`jest` types, `es2018` regex flags).
- [x] `npm run lint` — 0 errors, 0 warnings across every file this PR touches.
- [x] `npm run build` — clean.
- [x] `npm test` — 4926 pass / 1 fail. The failure
  (`lib/d2c/__tests__/brief-parser.test.ts`) is a date-rollover bug that
  predates this PR: it hard-codes `2026-09-01` and today is 2026-09-04, so the
  parser correctly resolves "1 September" to 2027. Verified failing with all
  of this PR's changes stashed.
- [x] Read-only backfill dry run against prod: 31 pairs across 13 clients.
- [x] Grep-guard: `evaluate.ts`, `tick-runner.ts`, `gates.ts` and `apply.ts`
  have zero imports from `lib/optimisation/presets.ts`.

97 new tests.

## Notes

**Two provenance axes, not one.** The brief said "if target is null, fall
back to the preset's benchmark target and mark provenance industry seed". A
single `source` field could not carry that without lying: a client's
hand-tuned ladder scaled by a benchmark stand-in is a real ladder with a
seeded number. `OptimisationPresetProvenance` therefore records `source`
(where the ladder came from) and `targetSource` (where the number came from)
separately, and step 2 marks them with separate badges.

**`UNIQUE (client_id, objective)` vs "save = a new version row".** These two
requirements from the brief are contradictory. The constraint won: one live
row per pair, `version` bumped on save. The immutable record of what version
N contained is the materialised strategy on each draft, which carries
`presetId` + `presetVersion` + `materialisedAt` — so a published campaign
still shows exactly which version it launched under, without a history table.

**The backfill found two mislabelled campaigns.** `Louder / Parable` and
`Electric Brixton` each have a published `purchase` campaign whose ladder is
CPR (a signups campaign copied and re-objectived). Seeding their purchase
presets from those would write a policy that silently ignores every
£-per-purchase target. `objectiveLadderMismatch` refuses the seed, falls back
to the industry seed, and names the campaign to fix. Worth fixing those two
campaigns' objectives and re-running before `--apply`.

**Deferred to PR 3:** the "apply preset to N drafts" action (explicit, never
automatic) and the zone D target editor.
