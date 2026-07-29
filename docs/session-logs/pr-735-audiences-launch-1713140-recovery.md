# Session log — Wire the #729 recovery ladder into launch-campaign engagement audiences

## PR

- **Number:** 735
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/735
- **Branch:** `cursor/audiences/launch-1713140-recovery`

## Summary

PR #729 built the grant/salvage/explain recovery ladder for Meta subcode 1713140
("Audience creation permission is missing for one or more event sources") for the
audience-builder write path (`lib/meta/audience-write.ts`), but the launch route's
own engagement-audience creation (`app/api/meta/launch-campaign/route.ts`) still
called `createEngagementAudience` in a plain try/catch with no auto-grant and no
salvage. Reproducer: the Modern Funktion Newcastle launch on NX Promoter
(`act_606252931141334`, 2026-07-29) — every "Similar Pages" (SPLAL) IG engagement
audience failed with 2654/1713140, exactly the failure #729 already fixed
elsewhere. This PR wires the same ladder into both engagement-audience call sites.

## What changed

- `app/api/meta/launch-campaign/route.ts` — added
  `createEngagementAudienceWithRecovery`, a thin wrapper around
  `createWithEventSourceRecovery` (parallel to `lib/meta/audience-write.ts`'s
  `createAudienceWithSeedRecovery`) that supplies `create` (the existing
  `createEngagementAudience` call) and `remediate`
  (`remediateAudienceSeeds` from #729, unchanged). Both call sites — Phase 1.5
  (page-group engagement) and Phase 1.5b (SPLAL / "Similar Pages") — now go
  through it instead of calling `createEngagementAudience` directly.
- `lib/types.ts` — `engagementAudiencesCreated[].note?: string`, populated only
  when the ladder had to grant access before the create succeeded.
- `components/steps/review-launch.tsx` — an engagement-audience success event
  with a `note` renders as `status: "warning"` (not `"success"`) with the note
  in `detail`, so the operator sees a permission was fixed on their behalf
  rather than assuming the create was clean. Matches the existing convention
  used for interest-replacement and lookalike-deferred events.

### Why this reduces to fix-or-explain, never salvage

Engagement audiences are single-source (one page or one IG asset per create),
unlike the audience builder's multi-page sets. `requested: [spec.sourceId]`
means the ladder's salvage stage (drop the named seed, keep the rest) always
reduces to zero usable seeds, so for this call site the ladder can only ever
grant-and-retry or fail with the real cause — there is no partial audience to
build. This is asserted directly in the new test (see below): a single-source
refusal makes exactly one `create` call, never a second with a reduced seed
set.

### `remediateAudienceSeeds` reused verbatim

No changes to `lib/audiences/seed-remediation.ts` — it already grants ADVERTISE
through the #727 validated primitive using the per-BM stored token, resolves
the business-scoped user, and never throws. The launch route's existing
`supabase` (cookie-bound, from `createClient()`) and `user.id` are already in
scope at both call sites, so no new client had to be threaded through.

## Scope / files

- `app/api/meta/launch-campaign/route.ts`
- `lib/types.ts`, `components/steps/review-launch.tsx`
- `lib/audiences/__tests__/launch-campaign-recovery-wiring.test.ts` (new)

No migration, no changes to `lib/audiences/event-source-recovery.ts` or
`lib/audiences/seed-remediation.ts` — both reused as-is from #729/#727.

## Validation

- [x] `npx tsc --noEmit` — diffed against a clean-`main` baseline: **zero new
      errors** (identical 447-line output before/after).
- [x] `npm run build` — clean.
- [x] `npm test` — 3262 tests, 14 failures, all pre-existing (clean-`main`
      baseline: 3254 tests, same 14 failures). **+8 new tests, all passing.**
- [x] New regression test
      (`lib/audiences/__tests__/launch-campaign-recovery-wiring.test.ts`),
      parallel to `seed-remediation-wiring.test.ts`:
      - Source-wiring assertions: both call sites use the recovery-wrapped
        helper (not raw `createEngagementAudience`); the note is conditionally
        attached at both push sites; the type and the review UI both handle it.
      - Behavioural: reproduces the Modern Funktion failure shape exactly
        (single `requested` id, 2654/1713140) against the REAL, already-merged
        `createWithEventSourceRecovery` — first attempt refused, remediation
        grants, retry succeeds, note mentions the granted source. A second
        behavioural test confirms the ladder still explains (not swallows) when
        remediation can't run (e.g. BM token expired). A third confirms exactly
        one `create` call happens when there is nothing to salvage — codifying
        the "fix or explain, never a reduced create" invariant for this
        call site.

## Notes

- The route handler itself can't be imported into a `node:test` file
  (`next/server` / `next/headers` don't resolve under
  `--experimental-strip-types`), so — same as #729's own
  `seed-remediation-wiring.test.ts` — coverage is source-text assertions on the
  route plus a behavioural run of the actual ladder module against the same
  call shape. This is an existing, accepted pattern in this codebase for
  route-handler logic that delegates to testable modules.
- Both connected Business Managers (Columbo Group, Electric Brixton) reported
  `token_expired = true` as of the #729 session log. If that's still true,
  auto-remediation on this path will also skip with "needs reconnecting" until
  they're reconnected at `/business-managers` — worth checking before this is
  used to explain a live Modern Funktion re-launch to the operator.
