# Session log — Ad set create resilience: salvage deleted audiences (1359207) and invalid Advantage+ automation (1870196)

## PR

- **Number:** 750
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/750
- **Branch:** `cursor/ad-set-launch-recovery-1359207-and-1870196`

## Summary

Two `createMetaAdSet` failures observed on the East End Dubs Newcastle signup
launch (2026-08-07, `act_606252931141334`, campaign `120251192078210755`) are
now handled by retry-once salvage ladders instead of failing the ad set
outright: Meta's "custom audience no longer available" refusal (code 100 /
subcode 1359207) and its "targeting automation type ... invalid" refusal
(subcode 1870196, hit by an `advantagePlus:true` ad set under an
`OUTCOME_LEADS` campaign). Both wrap the same `createMetaAdSet` call site in
Phase 2 (standard ad sets) and Phase 2b (lookalike ad sets), matching the
shape PR #729 established for the event-source-permission refusal. A
non-blocking preflight check also warns up front when any referenced custom
audience is already known-stale, before Phase 2 even runs.

## Failure payloads (operator-reported, task #115 / #116)

Neither of these is a byte-for-byte live capture — they are quoted verbatim
from the operator's report of the East End Dubs launch, unlike PR #729's
1713140 fixture. See the `_provenance` block in each fixture for the caveat.

**1359207 — "Similar Pages" ad set** (page_group, 10-page seed, 40+
engagement custom audiences):

```json
{
  "message": "This ad set is using one or more custom audiences, which are no longer available. You'll need to remove these unavailable audiences to publish this ad set.",
  "type": "OAuthException",
  "code": 100,
  "error_subcode": 1359207
}
```

Meta builds ad-set targeting atomically, so one aged-out audience among the
40+ rejected the whole ad set. Unlike the 1713140 refusal, this message does
**not** name the offending audience id(s) verbatim, so there is no id to
parse and drop directly — the ladder falls back to a batch
`delivery_status`/`operation_status` check.

Fixture: `lib/audiences/__tests__/fixtures/ca_deleted_1359207.json`.

**1870196 — "Wide" ad set** (`advantagePlus: true`) under a Registration
campaign (`OUTCOME_LEADS` objective, `LEAD_GENERATION` optimisation goal):

```json
{
  "message": "The targeting automation type passed is invalid. Please pass the correct one.",
  "type": "OAuthException",
  "code": 100,
  "error_subcode": 1870196
}
```

Fixture: `lib/meta/__tests__/fixtures/targeting_automation_1870196.json`
(named for what it actually is, not `event_source_permission_1870196.json`
as the brief suggested by analogy to 1713140 — this refusal has nothing to
do with event-source permissions).

## Diagnosis: is `targeting_automation.advantage_audience` the wrong field now?

Researched before writing the fix (`lib/meta/adset.ts`'s `buildMetaTargeting`,
Meta's public docs, and the schema of an MCP Meta-ads tool available in this
environment) rather than guessing:

- `buildMetaTargeting` sends `targeting.targeting_automation.advantage_audience: 1`
  when `advantagePlus` is true — correctly nested inside `targeting` (Meta
  does reject a top-level `targeting_automation`, but that's not what this
  code does).
- Meta has a **separate**, similarly-named feature — Advantage Detailed
  Targeting / Detailed Targeting Expansion — controlled by
  `targeting.targeting_optimization: "none" | "expansion_all"`. Meta's own
  docs for that field say plainly: *"If you use the `targeting_optimization`
  parameter for an unsupported objective, the API returns an error."* That is
  a different field for a different feature (expanding beyond specified
  interests vs. Advantage+ Audience's "let Meta pick the whole audience"),
  but the same *shape* of constraint — a Meta automation flag that some
  objectives reject — plausibly applies to `targeting_automation` too, and
  would explain why other `advantagePlus` ad sets in the **same** launch
  under non-LEADS objectives succeeded with the identical field shape while
  the LEADS one didn't.
- No public documentation states the current objective-support matrix for
  `targeting_automation.advantage_audience` specifically, and this repo has
  no `validate_only=true` probe path against a real ad account wired up for
  this session. Guessing a replacement field shape (e.g. moving to
  `targeting_optimization`, or a root-level `advantage_audience`) risked
  shipping a second wrong guess with no way to verify it before the next
  live launch.

**Decision:** ship the retry-once salvage ladder the brief asked for (strip
`targeting_automation`, retry with the operator's exact manual age range)
rather than a speculative field-shape substitution. This unconditionally
launches the ad set either way and is honest about the trade-off (a note on
the ad set, not a silent downgrade) — see `isInvalidTargetingAutomationError`
in `lib/meta/error-classify.ts` for the full citation trail.

## What shipped

**Diagnosis / pure recovery logic**

- `lib/audiences/ca-availability-recovery.ts` (new) —
  `isDeletedCustomAudienceError`, `parseOffendingCustomAudienceIds`, and
  `recoverFromDeletedCa(input) -> { recognised, keepIds, dropIds, note, unrecoverable? }`.
  Salvage → explain (no "fix" stage — unlike 1713140, a deleted audience
  can't be un-deleted). Pure and synchronous: the caller supplies
  `availabilityStatuses` when Meta's message names no id, rather than this
  module making a Graph call itself.
- `isInvalidTargetingAutomationError` added to `lib/meta/error-classify.ts`,
  same duck-typed shape as `isObjectiveIncompatibilityError`.

**Acting on it**

- `lib/meta/client.ts` — `fetchCustomAudienceAvailability(ids, token)`, a
  batched `GET /?ids=a,b,c&fields=id,delivery_status,operation_status`
  helper modelled on `fetchAdSetGuardInfo`. Drops any id with
  `delivery_status.code !== 200`, `operation_status.code` 411 (deleted) or
  412 (unavailable), or missing entirely from the batch response. Best-effort:
  returns `[]` on failure rather than guessing everything is fine.
- `app/api/meta/launch-campaign/route.ts` — both ladders wired into the
  existing Phase 2 (`standardSets`, batched) and Phase 2b (`lookalikeSets`,
  sequential) `createMetaAdSet` catch blocks, alongside the existing
  deprecated-interest (1870247) retry. Each is a single retry attempt; on
  failure the original create error surfaces to `adSetsFailed` as before.
  **Deliberately not** wired into the campaigns-2..N multi-campaign clone
  loop (`attach_campaign` with >1 campaign selected) — that loop already
  duplicates the 1870247 ladder independently rather than sharing code with
  Phase 2, and extending that duplication further was out of scope for this
  PR; flagged as a follow-up below.
- A non-blocking preflight step (0c-bis) batch-checks every custom-audience
  id referenced by an enabled ad set (page-group picks + auto-created
  engagement audiences, custom-audience groups, saved audiences) before
  Phase 2 runs, and pushes an amber `preflightWarning` — *"3 of 40 custom
  audiences referenced by your ad sets are no longer available..."* — when
  any are stale. Non-blocking: Phase 2's ladder is what actually drops them.

**Surfacing it**

- `lib/types.ts` — `LaunchSummary.adSetsCreated[].note?: string`.
- `components/steps/review-launch.tsx` — an ad set with a `note` renders as
  `warning` (not plain `success`) with the note as its detail line, mirroring
  how `engagementAudiencesCreated[].note` (PR #729) is already rendered.

## Scope / files

- `lib/audiences/ca-availability-recovery.ts` (new)
- `lib/audiences/__tests__/ca-availability-recovery.test.ts`,
  `fixtures/ca_deleted_1359207.json` (new)
- `lib/meta/__tests__/invalid-targeting-automation.test.ts`,
  `fixtures/targeting_automation_1870196.json` (new)
- `lib/meta/client.ts` — `fetchCustomAudienceAvailability` (new)
- `lib/meta/error-classify.ts` — `isInvalidTargetingAutomationError` (new)
- `app/api/meta/launch-campaign/route.ts` — Phase 2 + Phase 2b wiring,
  preflight stale-CA check
- `lib/types.ts` — `adSetsCreated[].note`
- `components/steps/review-launch.tsx` — render the note
- `docs/reference_meta_mcp_ads_update_entity_gotchas.md` (new)

No migration.

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files (baseline has
      pre-existing unrelated errors in `.next/dev/types` and several
      Jest-style test files that don't use the Node test runner).
- [x] `npm run build` — clean.
- [x] `npm test` — 3378 tests, 13 failures, all pre-existing (dashboard
      venue-trend-points/`@/lib` path-alias resolution, a canonical-tickets
      window test, and the creative-buy-tickets-cta rotation test — none of
      which this PR touches). +23 new tests, all passing.
- [x] `node --experimental-strip-types --test lib/audiences/__tests__/*.test.ts lib/meta/__tests__/*.test.ts`
      — 633 tests, 2 pre-existing failures (same `creative-buy-tickets-cta`
      test, and `page-access.test.ts` — a `server-only` import guard that
      fails when that one file runs outside the full `npm test` invocation;
      unrelated to `lib/meta/client.ts`, which imports neither module).

## Follow-up review (2026-08-07)

The task was re-issued verbatim in a later session, unaware this PR already
shipped. Reviewed the existing branch against the full acceptance criteria
instead of opening a duplicate PR:

- Recovery ladder shape, Phase 2 + Phase 2b wiring, tests, and fixtures all
  matched the spec (fixture naming for 1870196 intentionally deviates from
  the suggested `event_source_permission_1870196.json` — documented reason
  above still holds).
- Re-checked the "test via `ads_get_field_context` on Junction 2" diagnosis
  step from the original brief: the `user-meta-ads` MCP server's
  `create_ad_set` tool schema does **not** expose `targeting_automation` /
  `advantage_audience` / `validate_only` at all (checked its `targeting`
  object schema directly), so a live-probe correction genuinely wasn't
  possible with the tools available in this environment — confirms the
  original Diagnosis section's decision to ship the safe strip-and-retry
  ladder rather than a speculative field-shape substitution.
- The "Memory update after ship" step turned out to have a real gap: the
  memory file this repo's `docs/reference_meta_mcp_ads_update_entity_gotchas.md`
  couldn't find a prior version of actually exists — a Claude Code
  local-agent-mode session memory node (not under version control, outside
  this workspace) that already had 1487079 and 1815290. Added 1359207 and
  1870196 there too, next to their respective siblings, and cross-referenced
  both files from each other. See the updated intro paragraph of the in-repo
  doc for the exact path.

No code changes were needed — the implementation held up under review.

## Notes

- The 1870196 fix is a retry-once salvage, not a verified field-shape
  correction — see the Diagnosis section above. If Meta's rejection turns
  out to be structural (wrong field entirely) rather than objective-specific
  (right field, unsupported value for this objective), the retry will simply
  fail the same way every time for `OUTCOME_LEADS` + Advantage+, and the ad
  set will fall back to launching without Advantage+ Audience via the note
  — a safe degrade either way, but worth re-checking against a live
  `validate_only=true` probe if it recurs.
- Follow-up worth doing: extend both ladders to the campaigns-2..N
  multi-campaign clone loop in `launch-campaign/route.ts` (currently only has
  the 1870247 deprecated-interest retry, independently duplicated from
  Phase 2 rather than shared) — same gap PR #729 left for the oversized-set
  split paths.
- Follow-up: `recoverFromDeletedCa`'s `names` parameter (id → display name)
  is never populated from the live wiring — `draft.audiences` stores custom
  audience ids without names alongside them, so operator-facing notes and
  preflight warnings show raw Meta ids rather than "Similar Pages —
  engagement 40" style labels. Same degrade as `event-source-recovery.ts`
  when `names` is omitted.
- `reference_meta_mcp_ads_update_entity_gotchas.md` did not exist anywhere
  findable from this workspace (repo, `.cursor/`, `.claude/`, or home
  directory) at the time of this PR — created fresh at
  `docs/reference_meta_mcp_ads_update_entity_gotchas.md` with both subcodes,
  rather than appended to an existing file. If a prior version exists in a
  different tool's session memory outside this workspace, reconcile the two
  by hand — this one wasn't reconstructed from it.
