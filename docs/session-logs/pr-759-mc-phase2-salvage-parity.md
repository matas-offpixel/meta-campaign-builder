# Session log

## PR

- **Number:** 759
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/759
- **Branch:** `cursor/mc-phase2-salvage-parity`

## Summary

Task #125. PRs #750/#756/#757/#758 built up a full salvage ladder for
`launch-campaign/route.ts`'s standard Phase 2 (single-campaign wizard
launch) — readiness-wait for freshly-created engagement audiences, a
preflight availability check for large reused-audience ad sets, a hard
0-budget guard, a bounded 4-pass 1359207 (deleted custom audience) salvage
loop with a "meta lies" recreate-from-scratch fallback, the 1870196 →
1870227 chained-subcode fix, and a fallthrough diagnostic. None of that ever
reached the multi-campaign bulk-attach path (`MC[${ci}] Phase 2`/`Phase 2b`
in the same file) — which is what "Confirm & Launch" from the Asset Queue
actually runs. Any Similar Pages / Wide / Blank ad set launched from
bulk-attach still hard-failed with zero of these fixes.

Extracted the entire salvage ladder into a new dependency-injected module,
`lib/audiences/adset-create-with-salvage.ts`, and rewired ALL FOUR ad-set-
create call sites (standard Phase 2, standard Phase 2b, `MC[ci]` Phase 2,
`MC[ci]` Phase 2b) to call it — standard Phase 2's logic is the source of
truth; nothing was re-implemented for the multi-campaign path.

## Scope / files

- `lib/audiences/adset-create-with-salvage.ts` (new) — `prepareAdSetPayloadForCreate`
  (readiness-wait + preflight + budget guard, run once per ad set before the
  first `createMetaAdSet` attempt) and `createAdSetWithSalvage` (the full
  tiered ladder, run against an already-failed first attempt). Takes
  `createMetaAdSet`, `fetchCustomAudienceAvailability`, and
  `recreateEngagementAudiencesForGroup` as injected dependencies — no value
  import from `lib/meta/client.ts` (its `MetaApiError` class uses
  parameter-property syntax, which breaks `node --experimental-strip-types`).
  Both `MetaApiError` classification calls (`isDeletedCustomAudienceError`
  etc.) are duck-typed against plain error shapes for the same reason.
- `app/api/meta/launch-campaign/route.ts`:
  - Hoisted `engagementAudienceNameById` and the `audienceReadinessCache`/
    `getOrWaitAudienceReady` closure out of standard Phase 2's IIFE to outer
    (route-handler) scope so standard Phase 2b AND the `MC[ci]` loop can all
    share one readiness-wait cache and one audience-name lookup.
  - Built one `salvageDeps` object (closing over `supabase`, `user.id`,
    `adAccountId`, `userFbToken`, `pageToIg`, `pageNameMap`,
    `ENGAGEMENT_LABELS` for the `recreateEngagementAudiencesForGroup`
    dependency) and passed it into every one of the 4 call sites.
  - Standard Phase 2: replaced the inline readiness-wait/preflight/budget-
    guard block with `prepareAdSetPayloadForCreate`, and the inline
    CA-salvage loop / 1870196 / 1870227 / fallthrough block with
    `createAdSetWithSalvage`. The deprecated-interest retry (subcode
    1870247) stays inline — it needs first look at the error, ahead of the
    shared ladder (see the module's "Deliberately NOT covered" doc).
  - Standard Phase 2b (lookalikes): previously only had a single-pass 1359207
    retry and the (buggy, `delete`-based) 1870196 fix. Now calls both shared
    helpers — full parity with Phase 2, including the 4-pass loop, the
    preflight check, and the "meta lies" recreate fallback.
  - `MC[ci]` Phase 2 (standard ad sets, batched): previously had only a
    deprecated-interest retry and nothing else. Now calls both shared
    helpers, with the deprecated-interest retry staying inline exactly as in
    standard Phase 2.
  - `MC[ci]` Phase 2b (lookalikes): previously had zero salvage of any kind
    — a bare try/catch that logged and gave up. Now calls both shared
    helpers, matching standard Phase 2b.
  - New `const ciFreshlyCreatedEngagementAudienceIds = new Set(freshlyCreatedEngagementAudienceIds)`
    cloned once per attached campaign, before that campaign's ad sets are
    built — the per-campaign scoping boundary the brief asked for. In
    practice today the base set is never mutated after Phase 1.5 (the
    recreate-from-scratch fallback doesn't add to it), so this clone is
    currently a no-op in effect, but it makes the boundary explicit so a
    future change to that bookkeeping can't silently leak campaign `ci`'s
    recreated ids into campaign `ci+1`'s readiness-wait decision.
- `lib/types.ts` — `CampaignAttachResult.adSetsCreated[]` gained an optional
  `note?: string` field (mirrors `LaunchSummary.adSetsCreated[].note`) so the
  MC path's salvage notes (audiences dropped/recreated) are visible to the
  operator, not silently dropped.
- `lib/audiences/__tests__/adset-create-with-salvage.test.ts` (new) — 16
  tests covering `prepareAdSetPayloadForCreate` (budget guard, readiness
  wait, preflight threshold gating) and `createAdSetWithSalvage`'s 4 tiers
  in isolation (single-pass salvage, multi-pass loop, pass-cap error, "meta
  lies" recreate fallback + its negative case, 1870196's replace-not-delete
  fix, its chained-failure propagation, 1870227's advantage-flag retry in
  both directions, the fallthrough diagnostic rethrowing unchanged, and the
  readiness-wait overlay into the availability check).
- `lib/audiences/__tests__/mc-phase2-salvage-parity.test.ts` (new) — 7
  source-grep regression guards (same pattern as PR #758's
  `createEngagementAudienceWithRecovery` call-site guard in
  `launch-campaign-recovery-wiring.test.ts`): both shared helpers are called
  at exactly 4 sites each, the per-campaign fresh-ids clone is used by both
  MC call sites, no raw CA-recovery classifier is re-implemented outside the
  shared module, and `salvageDeps` is built once and reused everywhere.

## Design decisions / deviations from the brief

- **Standard Phase 2's own logic was moved wholesale into the shared module,
  not copied.** Both `prepareAdSetPayloadForCreate` and
  `createAdSetWithSalvage`'s tier order/behaviour are byte-for-byte what
  standard Phase 2 ran before this PR (confirmed by diffing the extracted
  logic against the pre-PR inline code) — the only routes for divergence
  now are `logPrefix` (cosmetic) and whichever `pageGroups`/`audienceNameById`
  a caller passes in.
- **`createEngagementAudienceWithRecovery` and `recreateEngagementAudiencesForGroup`
  stay in `route.ts`, not the new module.** Moving them would have required
  updating `launch-campaign-recovery-wiring.test.ts`'s call-site-count guard
  (which counts `await createEngagementAudienceWithRecovery(` occurrences in
  the route's source text) for no functional benefit — the new module takes
  `recreateEngagementAudiencesForGroup` as an injected dependency instead
  (a closure built once in `salvageDeps`, reused by every call site).
- **Deprecated-interest retry (subcode 1870247) stays at each call site,
  not inside the shared module.** It needs first look at the error (before
  the shared ladder's fallthrough diagnostic would log it as
  "unrecognised"), and its bookkeeping (`interestReplacements`,
  `launchRetryAttempted`, etc.) is specific to the standard wizard launch's
  summary — the MC path has no equivalent bookkeeping today. Documented in
  the module's own "Deliberately NOT covered" doc comment so a future
  reader doesn't wonder why 1870247 isn't one of the tiers.
- **`ciFreshlyCreatedEngagementAudienceIds` clones the OUTER set once per
  attached campaign** rather than being threaded through as a return value
  from a prior campaign's processing. Simpler, and matches the brief's
  explicit ask ("clone the base set... making the per-campaign boundary
  explicit") even though the clone is functionally a no-op today (see Scope
  above) — it's a deliberate seam for a future change, not dead code.
- **`CampaignAttachResult.adSetsCreated[].note` is a genuinely new field**,
  not previously present on the MC result shape. Without it, the MC path's
  salvage notes (e.g. "Launched without 3 unavailable audiences...") would
  have nowhere to surface to the operator, defeating half the point of
  porting the salvage ladder over.

## Validation

- [x] `node --test` on both new test files — 16 + 7 = 23 pass, 0 fail.
- [x] `npx tsc --noEmit` — zero errors in any file this PR touches (route.ts,
  types.ts, the new module, the two new test files); pre-existing baseline
  errors elsewhere unchanged.
- [x] `npx eslint` on every touched/new file — 0 errors; only the 4
  pre-existing unrelated warnings in `launch-campaign/route.ts`
  (`resolvePageIgActor`, `parseValidActorIdsFromError`, `isIgActorError`,
  one unused `_id`) remain, all pre-dating this PR. Removed 8 now-unused
  imports from `route.ts` (`isDeletedCustomAudienceError`,
  `parseOffendingCustomAudienceIds`, `recoverFromDeletedCa`,
  `preflightDropUnavailableAudiences`, `shouldRunPreflightAvailabilityCheck`,
  `REUSED_CA_PREFLIGHT_THRESHOLD`, `isInvalidTargetingAutomationError`,
  `isMissingAdvantageAudienceFlagError`, plus the now-unused
  `CustomAudienceAvailability` type import) now that their only callers live
  inside the shared module.
- [x] `npm test` (full suite) — 3596 tests (+23 vs. pre-PR), 3580 pass, 13
  fail. The 13 failures are pre-existing and unrelated (asset-queue sheet
  parsing/copy-generator, dashboard venue-trend/tier-smoothing module
  resolution, `canonical-tickets-window`, `creative-buy-tickets-cta`) — none
  touch `launch-campaign`, `adset-create-with-salvage`, or
  `ca-availability-recovery`.
- [x] Bonus fix discovered during validation:
  `lib/meta/__tests__/launch-campaign-placement-wiring.test.ts` ("every
  `buildAdSetPayload(...)` call forwards `draft.settings.placementConfig`")
  was FAILING on the pre-PR branch tip (2 call sites missing the argument —
  standard Phase 2b's old 1359207-salvage and 1870196-salvage rebuilds each
  called `buildAdSetPayload` without the trailing `placementConfig` arg).
  Consolidating Phase 2b's salvage into a single `buildAdSetPayload` call
  (built once, then handed to `prepareAdSetPayloadForCreate`/
  `createAdSetWithSalvage`) fixed this as a side effect — confirmed via
  `git stash` that the failure exists on the branch tip before this PR's
  diff and is gone after.
- [x] `npm run build` — succeeds.
- [ ] Live relaunch of a Similar Pages / Wide combination via bulk-attach —
  deliberately NOT performed; operator will verify after merge per the
  brief's "Do NOT relaunch live" instruction.

## Notes

- The regression-guard test intentionally asserts `isDeletedCustomAudienceError`
  etc. are ABSENT from `route.ts`'s source text now (not just present a
  certain number of times) — the whole point of this PR is that these
  classifiers only live inside the shared module going forward; a future
  edit re-adding a direct import to `route.ts` most likely means someone is
  about to re-implement a parallel (and drifting) copy of the ladder, which
  is exactly what caused task #125 to be necessary in the first place.
- `engagementAudienceNameById` and the readiness cache were previously
  built fresh inside standard Phase 2's own IIFE on every launch; hoisting
  them to outer scope means Phase 2b and the MC loop reuse the SAME cache
  instances, so a launch where a fresh audience is referenced by, say, a
  standard Phase 2 ad set AND an MC[2] ad set only pays the 30s readiness
  poll once, not once per call site.
