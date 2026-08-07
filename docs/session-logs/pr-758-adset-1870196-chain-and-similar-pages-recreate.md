# Session log

## PR

- **Number:** 758
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/758
- **Branch:** `cursor/adset-1870196-chain-and-similar-pages-recreate`

## Summary

PR #757 (task #123) shipped a looped 1359207 salvage and a preflight
availability check, but the IPC — Newcastle — Signup v3 draft
(`faf11b6f-bf7f-4ad8-9f4e-61bae0e2261c`) STILL failed to launch "Wide" and
"Similar Pages" on the very next relaunch attempt (2026-08-07 21:45 UTC,
trace `AwXXdOKyQMbDh8sbLfrquGg`). Two distinct, unrelated root causes.
Numbered task #124 in code comments (task #123 was PR #757's own numbering).

**FIX 1 — "Wide": chained-subcode failure, no salvage covers it.** PR #750's
1870196 (invalid targeting_automation type) handler retried by `delete`-ing
`targeting_automation` entirely and setting strict top-level `age_min`/
`age_max`. Since Meta's Marketing API v23.0+ requires
`targeting_automation.advantage_audience` to be explicitly `0` or `1` on
EVERY ad-set-create call, that retry's *own* omission of the field got
rejected with a DIFFERENT subcode, 1870227 ("missing advantage_audience
flag") — caught by the SAME try/catch, logged, and rethrown. PR #756's
1870227 handler (a sibling `if` block checking the *original* error) never
got a chance to run, because the chain never reached it — it was still
inside the 1870196 handler's own catch. Fixed by replacing (not deleting)
`targeting_automation` with an explicit `{ advantage_audience: 0 }` in the
same retry payload that already carries the strict top-level ages — this
satisfies both "invalid automation type" (no more `individual_setting`,
consistent with `buildMetaTargeting`'s own "Advantage+ OFF" branch shape in
`lib/meta/adset.ts`) and "flag required" (explicit, not omitted) in one
shot, so the retry never reaches 1870227 at all. Applied to BOTH the
duplicate 1870196 handlers in the file (Phase 2 standard ad sets, Phase 2b
lookalike ad sets) — same bug, same fix, in both places.

**FIX 2 — "Similar Pages": Meta's create validator disagrees with its own
availability read endpoint.** PR #757's preflight check asked
`/customaudiences?fields=delivery_status,operation_status` about 40 custom
audiences, correctly dropped the 11 it flagged, and retried with the 29
"clean" survivors — Meta's `createAdSet` STILL rejected the retry (subcode
1359207, no offending ids named). A second availability check on those
exact 29 ids (inside PR #757's own salvage loop) reported every one of them
fine. `recoverFromDeletedCa` correctly reports `unrecoverable` — there is
nothing it can point at and drop, and no read endpoint exposes whichever
stricter create-time rule Meta is actually applying. Added a third-tier
fallback: when the salvage loop is about to report unrecoverable AND at
least one audience was already dropped via preflight or a prior salvage
pass (i.e. availability-API trust has ALREADY failed once for this ad set),
recreate every engagement audience for the ad set's page group from scratch
— forced-fresh creates, bypassing Phase 1.5's "reuse existing" branch — and
run one final `createMetaAdSet` attempt with the brand-new ids. Capped to
one attempt per ad set per launch.

## Scope / files

- `app/api/meta/launch-campaign/route.ts`:
  - FIX 1: both 1870196 retry-payload builders (Phase 2, Phase 2b) now set
    `targeting_automation: { advantage_audience: 0 }` explicitly instead of
    `delete`-ing the field; ad set notes mention the explicit flag.
  - FIX 2: new `recreateEngagementAudiencesForGroup()` helper (mirrors Phase
    1.5's per-`(page, engagementType)` creation loop, minus the
    "reuse existing" branch); wired into the CA-salvage loop's
    `recovery.unrecoverable` branch with an idempotency guard
    (`hasAttemptedRecreateFallback`) and a `preflightDroppedCount` tracker so
    the trigger condition sees drops from EITHER the preflight check or a
    prior loop pass. On success, replaces the page group's
    `engagementAudienceStatuses` / `engagementAudiencesByType` /
    `engagementAudienceIds` with the fresh set so a future relaunch reuses
    the NEW ids, not the ones Meta just refused.
- `lib/audiences/__tests__/ca-availability-recovery.test.ts` — 3 new tests
  ("meta lies" scenario): unrecoverable + non-empty prior-drop count from
  preflight, unrecoverable + non-empty prior-drop count from a loop pass,
  and a negative case confirming a first-pass-with-zero-drops failure does
  NOT satisfy the fallback's trigger condition.
- `lib/audiences/__tests__/launch-campaign-recovery-wiring.test.ts` — updated
  the existing regression guard (previously pinned to exactly 2
  `createEngagementAudienceWithRecovery` call sites) to expect 3, now that
  FIX 2's recreate fallback is a legitimate third call site using the same
  recovery-wrapped helper (not a bypass).

## Design decisions / deviations from the brief

- **FIX 1 uses `advantage_audience: 0` unconditionally, not the brief's
  literal `adSet.advantagePlus ? 1 : 0`.** Checked Meta's own developer docs
  (`Advantage+ audience` reference page): v23.0+ requires the flag explicit,
  full stop — either value satisfies that requirement in isolation. But
  this specific retry ALREADY commits to stripping `individual_setting` and
  sending strict top-level `age_min`/`age_max` (that was PR #750's intended
  fallback shape, returned as `ageModeOverride: "strict"`), and
  `buildMetaTargeting` (`lib/meta/adset.ts`) documents, from prior
  first-hand debugging (task #116), that Meta rejects a strict top-level
  `age_max` under 65 combined with `advantage_audience: 1` — the exact
  combination `adSet.advantagePlus ? 1 : 0` would send for `advantagePlus:
  true` ad sets (Wide's own case). `0` is the only value consistent with
  the strict-age shape this branch already produces; sending `1` here would
  most likely just reproduce the ORIGINAL 1870196 rejection under a
  different guise. Documented in an inline code comment at both call sites
  rather than silently following the brief.
- **FIX 2's "prior drop" check spans preflight AND the loop, not just the
  loop.** The brief's condition ("at least 1 pass already dropped some
  CAs") reads loop-centric, but the reproducer's own narrative shows the
  FIRST drop happening in preflight (PR #757 FIX 2), with the loop's pass 1
  going straight to unrecoverable (zero loop-drops of its own) — under a
  strictly loop-only reading, the fallback would never fire for the exact
  scenario that motivated it. Added a `preflightDroppedCount` variable
  alongside the loop's own `allDroppedIds` so the trigger condition is
  `preflightDroppedCount + allDroppedIds.length > 0`, and added a test
  proving the negative case still holds (zero prior drops from either
  source correctly withholds the fallback — protects against always
  recreating on any unrecoverable outcome, e.g. a genuinely different first-
  attempt failure that happened to get routed into this branch).
- **Recreate-from-scratch replaces the group's engagement-audience
  bookkeeping wholesale, not additively.** `engagementAudienceIds` is fully
  reset to the freshly-created set (not unioned with the old, Meta-refused
  ids), and `engagementAudienceStatuses` entries for each recreated
  `(pageId, type)` pair are removed before the new ones are pushed — so a
  FUTURE relaunch's Phase 1.5 "reuse existing" branch picks up the fresh
  audience, not the stale one Meta just refused. Matches "recreate ALL...
  from scratch," read as a full reset rather than an additive merge.
- **The fallback is sequential, not parallelised**, across however many
  `(page, engagementType)` pairs the group has (up to 40 in the reproducer)
  — each `createEngagementAudienceWithRecovery` call already carries its
  own Graph-API retry ladder (PR #729's 1713140 recovery); running dozens of
  those concurrently risked tripping Meta's own rate limiter on what is
  already a last-resort path. Traded latency (worst case, tens of seconds)
  for safety, consistent with this fallback's "last resort" framing.
- **Only the single-campaign Phase 2 path gets the recreate fallback, not
  the multi-campaign (`MC[...]`) attach path or Phase 2b (lookalikes).**
  Same scope boundary PR #757 already drew for its own FIX 1/2. The
  reproducer's "Similar Pages" ad set is a page_group standard ad set,
  which only ever goes through the main Phase 2 loop. Lookalike ad sets
  (Phase 2b) target derived lookalike-of-custom-audience ids, not the raw
  engagement audiences this fallback recreates — recreating the SOURCE
  audiences wouldn't fix a lookalike ad set's own targeting anyway, since
  the lookalike id itself would need to be recreated, a different problem
  not reported in this reproducer.
- **Task numbering:** #124 (next free after #123, PR #757's own numbering).

## Validation

- [x] `node --test` on both touched test files — 8 + 28 = 36 pass, 0 fail
  (`launch-campaign-recovery-wiring.test.ts` guard updated to 3 call sites;
  `ca-availability-recovery.test.ts` +3 new "meta lies" tests).
- [x] `npm test` (full suite) — 3573 tests (+3 vs. `main`'s 3570), 3556 pass,
  14 fail — identical failure count and identical failing tests as `main`
  before this branch (confirmed via `git stash` diffing both ways). One
  regression surfaced and was fixed during validation: the recreate
  fallback's new call to `createEngagementAudienceWithRecovery` broke a
  guard test hard-pinned to exactly 2 call sites — updated the guard's
  expected count to 3 rather than working around it, since the new call
  site is a legitimate use of the same recovery-wrapped helper.
- [x] `npx tsc --noEmit` — 370 errors, identical count with and without this
  branch's changes (confirmed via `git stash`); zero errors in either file
  this PR touches.
- [x] `npx eslint` on every touched file — 0 errors/warnings introduced; the
  4 pre-existing warnings in `launch-campaign/route.ts` and the 1
  pre-existing `prefer-const` error in `launch-campaign-recovery-wiring.test.ts`
  (line untouched by this PR) are unchanged from `main`.
- [x] `npm run build` — succeeds.
- [ ] Live relaunch of the IPC Newcastle draft — deliberately NOT performed
  per the operator's "manual verification pending — operator will relaunch
  ... after merge" instruction.

## Notes

- Confirmed via Meta's own developer docs (Advantage+ audience reference,
  `developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/`)
  that Marketing API v23.0+ requires `targeting_automation.advantage_audience`
  explicit (0 or 1) on every ad-set-create call, and that the API returns an
  error precisely when a non-default targeting setup (a manual age range,
  here) is submitted WITHOUT that explicit flag OR without individual
  relaxation settings — matches this route's actual observed 1870196 →
  1870227 chain exactly.
- The recreate-from-scratch fallback is intentionally the LAST resort in a
  three-tier defence: (1) preflight (PR #757) catches most staleness before
  the first attempt for large reused-audience ad sets, (2) the 4-pass
  reactive salvage loop (PR #757) catches Meta naming ids in batches when
  its read endpoint agrees with itself across calls, (3) this fallback only
  fires when tiers 1+2 both failed AND Meta's own read endpoint contradicts
  its create-time validator — expected to be rare in practice.
- Recommended follow-up once this PR is reviewed: relaunch the IPC Newcastle
  draft live to confirm both fixes clear "Wide" and "Similar Pages", per the
  operator's stated verification plan.
