# Session log

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `cursor/attach-all-adsets-fix-and-multicampaign`

## Summary

Two tightly-coupled fixes to the wizard's "Attach ads to all existing ad sets" launch path (task #113 bug fix + task #114 feature), shipped together because they touch the same Phase 2 code:

1. **Bug fix (#113):** `attach_all_adsets` launches were duplicating ad sets. Phase 2 of `launch-campaign/route.ts` only special-cased `wizardMode === "attach_adset"` when deciding whether `standardSets`/`lookalikeSets` should be empty and whether `adSetCreationPromise` should run. `attach_all_adsets` fell through: Phase 2 already fetches every live ad set across the selected campaigns and seeds `adSetMetaIds` with synthetic keys, but `adSetCreationPromise` then *also* ran against `draft.adSetSuggestions` (the wizard's own Step-5 ad-set definitions, always present in the draft), creating brand-new ad sets on top of the live ones. Every re-launch doubled the ad-set count.

   **Reproducer:** East End Dubs Newcastle signup campaign (act `606252931141334`, campaign `120251160301180755`) — 27 ad sets, roughly half auto-duplicated by the wizard on the last `attach_all_adsets` launch. Same root cause and fix shape as the earlier `attach_adset`-only fix (see `docs/session-logs/pr-609-cursor-pr605-attach-adset-skip-phase-2-creation.md`, subcode `1885621` CBO reproducer) — that fix never covered `attach_all_adsets`.

   **Fix:** extracted `shouldSkipAdSetCreation(wizardMode)` (`lib/meta/attach-adset-skip.ts`) — true for both `attach_adset` and `attach_all_adsets` — and used it to short-circuit `standardSets`/`lookalikeSets` to `[]` and to gate `adSetCreationPromise`'s early return. `new` and `attach_campaign` are unaffected.

2. **Feature (#114):** the operator wants to select **multiple** existing campaigns — with different objectives (Traffic + Sales + Awareness + Registration, etc.) — in `attach_all_adsets` mode, and have the same set of new ads attached to every ad set across all of them. The backend already iterated `verifiedCampaigns[]` and pooled ad sets from each (PR #596), but Phase 0 hard-blocked the launch with a 409 the moment more than one selected campaign had a different objective, and the wizard UI (`CampaignMultiPicker`) greyed out any campaign whose objective didn't match the first-selected one — so a multi-objective selection was never reachable from the wizard.

   **Backend:** relaxed the Phase 0 objective check — `assertSameObjective` failing no longer returns a 409; it now pushes a `preflightWarnings` entry (`stage: "attach_all_adsets_objective"`, `severity: "amber"`) and the launch proceeds. Each ad set keeps its own parent campaign's objective (no ad set/campaign mutation happens in this path either way). Extracted the ad-set pooling loop into `buildAttachAllAdSetsMap()` (`lib/meta/attach-all-adsets.ts`) for unit testability — pools ad sets across every selected campaign into one flat synthetic-key map, respecting the shared `ATTACH_ALL_ADSETS_CAP`, skipping `ARCHIVED`/`DELETED` ad sets, and tolerating a single campaign's fetch failure without aborting the rest.

   Added `isObjectiveIncompatibilityError()` (`lib/meta/error-classify.ts`) to recognise Meta's "creative doesn't match ad set's objective" family (subcodes `1815159`, `1487664`, plus a message-phrase fallback for undocumented siblings) and used it in `formatMetaError` to prefix a plain-English hint on any Phase 4 per-ad failure, so a mixed-objective launch's partial-launch report (`creativesCreated[].adsFailed`) reads as an actionable instruction instead of raw Meta jargon.

   Guarded the multi-campaign attach loop near the bottom of the route (`isMultiCampaignAttach && !isAttachAllAdSets`) — `attach_all_adsets` already attaches every ad to every pooled ad set in the main Phase 2/4 pass, so re-running that loop for campaigns 2..N would both waste a rate-limit sleep and push a misleading zero-count `campaignAttachResults` entry.

   **Wizard UI:** removed the same-objective grey-out (`getObjectiveDisabledReason`) and the objective-match block inside `handleToggleCampaign` — `attach_all_adsets` now behaves like `attach_campaign`/`attach_adset` (any live campaign is selectable). Added a non-blocking amber notice ("Mixed objectives selected...") inside the "Selected campaigns" card, shown only when `attach_all_adsets` has >1 selected campaign with differing objectives, explaining that only the affected ads (if any) will fail rather than the whole launch. The per-campaign objective badge now reads each campaign's own `internalObjective` instead of the single `settings.objective`, since that field no longer applies uniformly across a mixed selection.

## Scope / files

- `app/api/meta/launch-campaign/route.ts` — Phase 0 objective check → preflight warning; Phase 2 ad-set pooling via `buildAttachAllAdSetsMap`; `skipAdSetCreation` guard (bug fix); `formatMetaError` objective-mismatch hint; multi-campaign loop guard
- `components/steps/campaign-setup.tsx` — remove same-objective grey-out/block for `attach_all_adsets`; mixed-objective notice; per-campaign objective badge
- `lib/types.ts` — `attach_all_adsets` JSDoc updated to describe mixed-objective support
- `lib/meta/attach-objective.ts` — `assertSameObjective` JSDoc: informational, not a hard block, as of #114
- `lib/meta/attach-adset-skip.ts` (new) — `shouldSkipAdSetCreation(wizardMode)`
- `lib/meta/attach-all-adsets.ts` (new) — `buildAttachAllAdSetsMap()`
- `lib/meta/error-classify.ts` — `isObjectiveIncompatibilityError()`
- Tests: `lib/meta/__tests__/attach-adset-skip.test.ts`, `lib/meta/__tests__/attach-all-adsets.test.ts`, `lib/meta/__tests__/error-classify.test.ts` (new)

## Validation

- [x] `node --test lib/meta/__tests__/attach-adset-skip.test.ts lib/meta/__tests__/attach-all-adsets.test.ts lib/meta/__tests__/error-classify.test.ts` — all new tests pass
- [x] `npm run test` — 3339/3355 pass; the 13 failures are pre-existing on `main` (verified via stash), unrelated to this PR
- [x] `npx tsc --noEmit` — clean
- [x] `npm run build` — clean
- [x] `npm run lint` — no new warnings/errors on touched files (pre-existing unused-var warnings in `launch-campaign/route.ts` predate this change)

## Notes

- The operator had an uncommitted local partial fix for #113 on `app/api/meta/launch-campaign/route.ts`; per instructions it was discarded (`git restore`) and this branch was cut fresh off `main` so the diff is clean.
- Draft persistence: `attach_all_adsets` already stores `existingMetaCampaigns[]` (plural, array) on `CampaignDraft.settings` — no `campaignId` → `campaignIds[]` migration was needed; that singular/plural split only ever existed for `attach_campaign`'s older shape, and `attach_all_adsets` was added later already using the array field.
- Acceptance criteria are satisfiable end-to-end: wizard multi-select → launch pools ad sets from all selected campaigns → same ads attached to all of them → each ad set keeps its own campaign's objective → any objective/creative mismatch is caught per-ad in Phase 4 and reported in the launch summary, plus a preflight-time warning banner in the wizard itself.
