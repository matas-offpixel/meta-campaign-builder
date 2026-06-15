# Session log — PR #602

## PR

- **Number:** 602
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/602
- **Branch:** `cc/pr602-trust-operator-override-and-prune-orphan-assignments`

## Summary

Two bugs identified in the PR #601 audit (`docs/audits/pr-601-audit-2026-06-12.md`).

**Fix 1 (Error B — @ionfestival rejection):** `ig-actor-validator.ts` was treating operator-selected
IG overrides the same as auto-resolved guesses, running the pick through page-list / BM-asset list
lookups and returning `null` if neither matched. That `null` caused `buildCreativePayload` to omit
`instagram_user_id` entirely, letting Meta default to the page's primary IG (`@ionfestival`),
triggering EU DMA subcode 3858231. Fix: when `operatorOverrideId === igActorId`, return immediately
before any list check. Diagnostic lookups still fire as a fire-and-forget background task for
observability but can no longer block the return value.

**Fix 2 (Error A — "no metaAdSetId available"):** Phase 4 of the launch route was emitting a hard
ad-level failure when `creativeAssignments` contained keys that weren't in `adSetMetaIds` (stale
from a prior Step-1 selection). Fix: detect the orphan key, log a warning, skip silently, and
record the skip in a new `skippedOrphanAdSets` array surfaced in `LaunchSummary` so the UI can
explain the discrepancy without a hard error.

## Scope / files

- `lib/meta/ig-actor-validator.ts` — trust-first operator override early return (lines ~163–206)
- `app/api/meta/launch-campaign/route.ts` — orphan adSet soft skip + `skippedOrphanAdSets` accumulator
- `lib/types.ts` — `LaunchSummary.skippedOrphanAdSets` field added

## Validation

- [x] `npx tsc --noEmit` — zero errors in changed files (pre-existing unrelated errors elsewhere)
- [ ] `npm run build` — blocked by Google Fonts network error in this environment (pre-existing)
- [ ] Manual prod test: attach_adset LWE + @l_w_e, verify `resolvedIgId=17841400485165463` in Phase 3 logs

## Notes

- Per audit §5 and `feedback_validate_only_for_meta_field_bugs`: run Probe 0
  (`GET /145163125507298/instagram_accounts`) + Probe A (`validate_only=true` with
  `instagram_user_id=17841400485165463`) before declaring Error B fixed. If Probe A rejects,
  the fix is insufficient and the problem is a Meta-side asset/permission issue, not code.
- PR #596 → #600 → #601 → #602 arc: if this PR still fails on prod, do NOT open #603.
  Trigger a full architecture audit of the launch route's identity-handling instead.
- `skippedOrphanAdSets` is not yet surfaced in the wizard UI — the data reaches the client via
  `launchSummary` on the draft but there's no banner for it yet. Low priority until confirmed
  needed after the prod test.
