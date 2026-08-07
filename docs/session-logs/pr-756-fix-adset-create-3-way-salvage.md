# Session log

## PR

- **Number:** 756
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/756
- **Branch:** `cursor/fix-adset-create-3-way-salvage`

## Summary

Fixes three independent ad set creation failures observed on the IPC — Newcastle
— Signup v2 launch (2026-08-07 20:15 UTC, `act_606252931141334`, campaign
`120251197739380755`, draft `faf11b6f-bf7f-4ad8-9f4e-61bae0e2261c`). No relaunch
was performed — fixes were validated via unit tests only, per the operator's
explicit "do NOT relaunch live" instruction. Numbered task #122 in code
comments (task #117 was already claimed by the wizard-wide Placements config,
PRs #751/#752 — see "Notes").

**FIX 1 — Similar Pages / populating race (subcode 1359207 without stale CAs).**
PR #750's 1359207 salvage ladder didn't recover this launch's "Similar Pages"
ad set because its custom audiences weren't deleted — they were still
`operation_status.code=441` ("populating"), having been created seconds
earlier in the same launch's Phase 1.5. `fetchCustomAudienceAvailability`
only flags 411/412 (genuinely deleted) as unavailable, so the existing
reactive salvage saw the audience as "available" and returned `dropIds=[]`
(unrecoverable). Added `waitForAudienceReady` (`lib/meta/client.ts`) — a
bounded poll (default 30s / 3s interval) that keeps polling only while a CA
is 441 (populating) or 400 (processing), and returns immediately (no wait
burned) for 200 (ready), any error code, or "not found". Wired into
`launch-campaign/route.ts`'s Phase 2: before each ad set's first
`createMetaAdSet` call, any of its custom-audience ids created earlier in
*this same launch run* (`freshlyCreatedEngagementAudienceIds`) are waited on
(shared across concurrently-created ad sets via an in-memory cache, so N ad
sets referencing the same fresh audience only poll it once). If the wait
still times out and Meta subsequently rejects the ad set with 1359207, the
wait's outcome is merged into the existing `availabilityStatuses` array
before calling `recoverFromDeletedCa` — this is the actual fix: the
generically-typed pure recovery function already handled `available: false`
correctly, it was just never being TOLD a fresh-but-still-populating audience
was unavailable.

**FIX 2 — Wide ad set subcode 1870227 (missing `advantage_audience` flag).**
Distinct from PR #750's subcode 1870196 (Meta rejects the *value*
`advantage_audience: 1` for the objective — salvage strips it entirely).
1870227 instead means the field wasn't explicitly `0`/`1` from Meta's point
of view for this ad set's objective, even though `buildMetaTargeting`
(`lib/meta/adset.ts`) already always sets it. Added
`isMissingAdvantageAudienceFlagError` (`lib/meta/error-classify.ts`) matching
subcode 1870227 (+ a message-phrase fallback, same pattern as its sibling
classifiers). On catch in `launch-campaign/route.ts`, retries once with
`targeting_automation: { advantage_audience: adSet.advantagePlus ? 1 : 0 }`
set explicitly (dropping `individual_setting` age suggestions on that one
retry, per the literal brief) and records a
`"Set advantage_audience=X explicitly per Meta requirement."` note.

**FIX 3 — Blank ad set subcode 1885272 (budget 0).** PR #753's
`createBlankAdSetSuggestion` (`lib/wizard/adset-suggestions.ts`) hardcoded
`budgetPerDay: 0` — Meta rejects ad set creation outright with subcode
1885272 when `daily_budget` is 0. Added `defaultBlankAdSetBudget(existing,
campaignDefault)`, which returns
`Math.max(median(existing.budgetPerDay), campaignDefault, 100)`, and wired it
into `budget-schedule.tsx`'s `addBlankAdSet()`. `createBlankAdSetSuggestion`
also gained a `defaultBudgetPerDay` parameter (defaults to the 100 floor, and
clamps any 0/negative value passed in up to 100) as a second line of
defence. Added a server-side guard in `launch-campaign/route.ts`'s Phase 2:
if `adSetPayload.daily_budget <= 0`, the ad set fails fast with `Ad set "X"
has no budget — set a daily budget in Step 5.` before ever calling Meta —
this catches the case regardless of how a 0 budget slipped through the UI.

## Scope / files

- `lib/meta/client.ts` — new `waitForAudienceReady` + `AudienceReadinessWaitResult`
  (FIX 1).
- `lib/audiences/__tests__/ca-availability-recovery.test.ts` — extended with a
  test pinning that a still-populating (op=441) audience marked
  `available: false` by the caller is dropped by `recoverFromDeletedCa`
  exactly like a genuinely-deleted one (FIX 1). No changes needed to
  `recoverFromDeletedCa` itself — it was already availability-status-agnostic
  about *why* an id is unavailable.
- `lib/meta/error-classify.ts` / `lib/meta/__tests__/error-classify.test.ts` —
  new `isMissingAdvantageAudienceFlagError` + 6 new tests (FIX 2).
- `lib/wizard/adset-suggestions.ts` / `lib/wizard/__tests__/adset-suggestions.test.ts` —
  new `defaultBlankAdSetBudget`, `createBlankAdSetSuggestion`'s new
  `defaultBudgetPerDay` param + 9 new tests (FIX 3).
- `components/steps/budget-schedule.tsx` — `addBlankAdSet()` now computes and
  passes the default budget (FIX 3).
- `app/api/meta/launch-campaign/route.ts` — Phase 1.5/1.5b track freshly-created
  engagement audience ids; Phase 2 waits on them before creating an ad set and
  merges the wait outcome into the 1359207 salvage's availability check
  (FIX 1); a new catch handler retries once on subcode 1870227 with
  `advantage_audience` set explicitly (FIX 2); a new hard validation throws
  before `createMetaAdSet` when `daily_budget <= 0` (FIX 3).

## Design decisions / deviations from the brief

- **Task numbering:** the brief didn't specify a task number, and my working
  comments initially used "task #117" (matching the reproducer's own campaign
  naming pattern) before I discovered PR #751/#752 already claimed #117 for
  the wizard-wide Placements config. Renumbered every new comment to task
  #122 (the next free number after #120/#121) before committing — confirmed
  via `grep -rn "task #11[7-9]\|task #12[0-9]"` across the tree that #122 is
  unclaimed.
- **FIX 1's "pass to recoverFromDeletedCa as unavailable" — read as enriching
  the reactive salvage, not a proactive drop.** The brief's wording could be
  read as "drop the still-populating id from the ad set's FIRST attempt", but
  re-reading closely ("dropped from the *retry* payload") plus the existing
  code shape (the reactive 1359207 catch handler already threads an
  `availabilityStatuses` array into `recoverFromDeletedCa`) pointed at a
  smaller, more surgical fix: wait proactively (so a genuinely-fast-populating
  audience has a chance to become ready before the FIRST attempt, the best
  outcome — full targeting, no salvage needed at all), but only feed the
  wait's per-id outcome into the EXISTING reactive salvage's
  `availabilityStatuses` if the first attempt still fails. This reuses
  `recoverFromDeletedCa`'s note/keep/drop logic entirely unchanged (it was
  already availability-status-agnostic about the underlying Meta status
  code) rather than duplicating it in a new proactive-drop code path.
- **FIX 1 test location:** the brief asked to extend
  `ca-availability-recovery.test.ts` with "recovery WITH populating (op=441)
  status → dropped in salvage" — done, but the test necessarily exercises
  `recoverFromDeletedCa`'s existing generic `availabilityStatuses` handling
  (no source change needed there) rather than a new 441-specific branch,
  since the actual fix lives in the CALLER (`launch-campaign/route.ts`, not
  independently unit-testable per `lib/meta/client.ts`'s parameter-property
  class declarations breaking `node --test`'s strip-only mode — same
  constraint documented in `lib/meta/error-classify.ts`'s file header).
- **FIX 3 test location:** the brief named
  `components/steps/__tests__/budget-schedule.test.tsx`, but this repo has no
  jsdom/RTL harness (confirmed via several other `__tests__` files' own
  "repo lacks a jsdom/RTL harness" notes) and `budget-schedule.tsx`'s only
  new logic is a one-line call into a pure helper. Put the actual logic
  (`defaultBlankAdSetBudget`) in `lib/wizard/adset-suggestions.ts` — right
  next to `createBlankAdSetSuggestion`, which it exists to feed — and
  extended the sibling `lib/wizard/__tests__/adset-suggestions.test.ts`
  (`node --test`-compatible, no rendering needed) instead of creating an
  untestable `.tsx` file.
- **FIX 2's retry payload** follows the brief literally
  (`targeting_automation: { advantage_audience: X }`, replacing the whole
  object) rather than preserving `individual_setting`'s age suggestions —
  matches PR #750's precedent for the sibling 1870196 salvage (which also
  drops `targeting_automation` — in that case entirely — and substitutes
  explicit `age_min`/`age_max` instead).
- **Branch ownership:** the brief specified `cc/fix-adset-create-3-way-salvage`
  (a Claude Code-owned prefix per `CLAUDE.md`'s tool-ownership convention).
  Flagged to the operator before starting; they chose
  `cursor/fix-adset-create-3-way-salvage` instead.

## Validation

- [x] `node --test` on the 3 touched/new test files — 51 pass, 0 fail.
- [x] `npm test` (full suite) — 3496 tests (+16 vs. main's 3480), 3479 pass,
  14 fail — identical failure count and identical failing tests as a clean
  `main` before this branch (confirmed via `git stash` diffing both ways).
  None of the 14 touch any file this PR modifies.
- [x] `npx tsc --noEmit` — 371 errors, identical count to `main` (confirmed
  via `git stash`); zero errors in any file this PR touches.
- [x] `npx eslint` on every touched file — 0 errors; the 4 pre-existing
  warnings in `launch-campaign/route.ts` (unused imports/vars) are unchanged
  from `main` (confirmed via `git stash`).
- [x] `npm run build` — succeeds.
- [ ] Live relaunch of the IPC Newcastle draft — deliberately NOT performed
  per the operator's "do NOT relaunch live... happy with dry-run/test only
  until fix reviewed" instruction.

## Notes

- FIX 1's 30s/3s-interval poll adds up to 30s of latency to Phase 2 ad set
  creation, but ONLY for ad sets referencing a custom audience created
  earlier in the *same* launch run — audiences reused from a prior run (via
  `engagementAudienceStatuses`) are unaffected, and the vast majority of
  launches (no fresh page_group audiences, or audiences that become ready in
  well under 30s) will see little to no added latency in practice.
- FIX 2 is a narrower, more conservative fix than a full audit of every
  `buildMetaTargeting` call site — Meta's exact objective/automation-type
  support matrix for `advantage_audience` isn't published (same caveat PR
  #750's session log recorded for 1870196), so this is a reactive retry
  rather than a proactive payload change.
- Recommended follow-up once this PR is reviewed: relaunch the IPC Newcastle
  draft (or a fresh copy of it) live to confirm all three fixes clear the
  original failures end-to-end.
