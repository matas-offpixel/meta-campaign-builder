# Session log

## PR

- **Number:** 760
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/760
- **Branch:** `cursor/step5-adset-naming-and-advantage-plus-gating`

## Summary

Task #126. Two Step 5 (Budget & Schedule) issues surfaced by the East End
Dubs Newcastle signup v2 launch (draft `1c8381cb-d4b3-4a72-a7bc-a56d0e139b28`):

1. **Advantage+ Audience objective gating.** Meta rejects
   `targeting_automation.advantage_audience: 1` outright (code 100, subcode
   1870196) for `OUTCOME_LEADS`/registration and `OUTCOME_AWARENESS`
   campaigns, but the wizard let operators enable the per-row toggle anyway.
   The existing salvage ladder (PR #758) strips the flag and retries —
   succeeding, but silently producing an ad set identical to a strict-mode
   sibling, so an operator who duplicated an ad set specifically to A/B
   Advantage+ vs strict ends up with two indistinguishable rows and no
   warning. Added a shared compat matrix
   (`lib/meta/advantage-plus-compat.ts`), disabled the toggle in the UI
   when unsupported, and added a launch-time preflight that now fails fast
   with a clear error instead of relying on the salvage ladder to paper
   over the mismatch.
2. **Inline ad set name editing.** `s.name` was read-only in Step 5, so a
   duplicated ad set stuck with "... (copy)" with no way to rename it
   inline to reflect an A/B pair. Added an inline text input (40-char cap)
   and made `duplicateAdSetSuggestion` itself smarter: when the campaign
   objective supports both modes, duplicating now flips the copy's
   `advantagePlus` and names it "... – Strict" / "... – Adv+" so the pair
   reads as an intentional A/B instead of an identical clone.

## Scope / files

- `lib/meta/advantage-plus-compat.ts` (new) — `isAdvantageAudienceSupportedForObjective(objective, optimisationGoal)`
  (source of truth: blocks `registration` and `awareness` outright, any
  goal; everything else supported), `objectiveDisplayName` (UI copy), and
  `advantageAudienceObjectiveMismatchMessage` (shared preflight error text).
- `lib/meta/__tests__/advantage-plus-compat.test.ts` (new) — full
  5-objective × 9-goal matrix sanity check, the exact East End Dubs
  reproducer combo, and the mismatch-message helper.
- `components/steps/budget-schedule.tsx`:
  - Computes `advantagePlusSupported` once from `settings.objective` +
    `settings.optimisationGoal`; disables the per-row Advantage+ toggle
    (in addition to the existing blank-ad-set lock) with an updated
    tooltip ("Meta doesn't support Advantage+ Audience for [objective]
    campaigns. Toggle disabled.") and shows a campaign-level banner when
    unsupported.
  - Replaced the read-only `<span>{s.name}</span>` with an inline
    `<input>` (40-char `maxLength`, transparent border until
    hover/focus) wired through the existing `updateSuggestion(s.id, { name })`
    pattern.
  - `duplicateRow` now passes `advantagePlusSupported` into
    `duplicateAdSetSuggestion`.
- `lib/wizard/adset-suggestions.ts`:
  - `duplicateAdSetSuggestion` gained a third `advantagePlusSupported`
    param (default `true`). When the source isn't a blank ad set and the
    objective supports both modes, the copy's `advantagePlus` flips from
    the source's; otherwise the copy is identical (blank ad sets are
    always locked to Advantage+ ON; unsupported objectives keep the copy
    strict rather than flipping into a mode Meta would reject).
  - New `resolveDuplicateAdSetName(original, copyAdvantagePlus)` — pure,
    exported, unit-tested: `" – Strict"` / `" – Adv+"` when the mode
    changed, `" (copy)"` otherwise, truncating with an ellipsis to stay
    within the new exported `MAX_ADSET_NAME_LENGTH` (40).
- `lib/wizard/__tests__/adset-suggestions.test.ts` — updated the existing
  `duplicateAdSetSuggestion` describe block for the new flip behaviour
  (was asserting verbatim-clone `advantagePlus`/name) and added dedicated
  `resolveDuplicateAdSetName` tests.
- `app/api/meta/launch-campaign/route.ts` — added an objective-gated
  preflight check at all 4 ad-set-create call sites (standard Phase 2,
  standard Phase 2b lookalikes, `MC[ci]` Phase 2, `MC[ci]` Phase 2b): if
  `adSet.advantagePlus && !isAdvantageAudienceSupportedForObjective(...)`,
  fail immediately — before ever calling `createMetaAdSet` — instead of
  letting the salvage ladder's 1870196 handler silently strip the flag.
  The salvage's 1870196 handler stays in place as a backup for any combo
  this matrix doesn't yet know about.
- `lib/meta/__tests__/launch-campaign-advantage-plus-preflight-wiring.test.ts`
  (new) — source-grep regression guard (same pattern as PR #759's
  `mc-phase2-salvage-parity.test.ts`) asserting the preflight check exists
  at exactly 4 call sites, runs before `buildAdSetPayload`, and uses the
  correct control-flow shape per site (`throw { adSet, err }` for the two
  `.map()`+`Promise.allSettled` sites vs. record-failure-and-`continue`
  for the two `for`-loop sites — throwing into the `for`-loop sites would
  route the preflight error into `createAdSetWithSalvage` as
  `initialError`, wasting the whole ladder on an error none of its
  classifiers match).

## Design decisions / deviations from the brief

- **No "campaign-wide default" Advantage+ toggle exists in this codebase**
  (confirmed by exploration — Advantage+ is per-row only; "campaign-wide"
  in Step 5 refers to Placements, a separate concept). The brief's "disable
  the per-row toggle AND the campaign-wide default" is satisfied by
  disabling the per-row toggle for every row (since all rows in a campaign
  share the same objective/goal) plus a single campaign-level banner
  explaining why — there was no second control to disable.
- **The launch-time preflight runs before the FIRST `createMetaAdSet`
  attempt, not only "before calling `createAdSetWithSalvage`"** (the
  brief's literal phrasing). Interpreted per the brief's own stated intent
  — "reject it upfront ... rather than silently degrading via salvage" —
  since checking only inside the catch path would still burn a real Meta
  API call and, for the two `for`-loop sites, would incorrectly feed the
  preflight error into the salvage ladder as `initialError` (see the
  regression-guard test's rationale above).
- **`duplicateAdSetSuggestion` flips `advantagePlus` on the copy when
  possible.** The brief's phrasing ("if the original has advantagePlus:true
  and copy will be false, name the copy '... – Strict'") only makes sense
  if the duplicate function decides the copy's mode, not just its name —
  otherwise there's no state transition to name. This closes the loop on
  the reported bug (identically-configured "Similar Pages" /
  "Similar Pages (copy)" rows) by making a fresh duplicate instantly a
  useful A/B pair when the objective allows it, falling back to the
  original identical-clone + "(copy)" behaviour when it doesn't (blank ad
  sets, or objectives where Advantage+ is unsupported entirely).

## Validation

- [x] `node --experimental-strip-types --test` on all new/changed test
  files — `advantage-plus-compat.test.ts` (10 pass),
  `launch-campaign-advantage-plus-preflight-wiring.test.ts` (5 pass),
  `adset-suggestions.test.ts` (31 pass, updated + new cases) — 0 fail.
- [x] `npx tsc --noEmit` — zero errors in any file this PR touches;
  pre-existing baseline error count (370) unchanged.
- [x] `npx eslint` on every touched/new file — 0 errors, 0 new warnings
  (the 4 pre-existing unrelated warnings in `launch-campaign/route.ts`
  remain untouched).
- [x] `npm test` (full suite) — 3619 tests, 3603 pass, 13 fail (0 net
  change from baseline vs. pre-PR main; new failures excluded — the 13
  are the same pre-existing dashboard/asset-queue/creative-buy-tickets-cta
  failures unrelated to this PR's scope, confirmed by name).
- [x] `npm run build` — succeeds.

## Notes

- Both `assertAdvantageAudienceObjectiveCompat`-style checks and the UI
  gate read from the SAME `isAdvantageAudienceSupportedForObjective`
  function, so the toggle being enabled in the UI and the launch
  succeeding can never drift apart in the future — any new
  objective/goal restriction Meta adds only needs one edit
  (`lib/meta/advantage-plus-compat.ts`).
- Did not touch `lib/meta/adset.ts`'s existing (unrelated)
  `VALID_GOALS_BY_OBJECTIVE`/`resolveOptimisationGoal` — that governs
  objective↔optimisation-goal validity generally; this PR's matrix is
  specifically about Advantage+ Audience eligibility, a narrower and
  independent concern.
