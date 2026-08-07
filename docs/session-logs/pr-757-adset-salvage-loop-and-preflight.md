# Session log

## PR

- **Number:** 757
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/757
- **Branch:** `cursor/adset-salvage-loop-and-preflight`

## Summary

PR #756's reactive 1359207 (unavailable custom audience) salvage was single-pass;
Meta can reveal stale audiences in successive batches, and the second batch
hard-failed the ad set instead of triggering a second recovery attempt.
Reproducer: IPC — Newcastle — Signup v3 launch, 2026-08-07 21:11 UTC
(`act_606252931141334`, campaign `120251198620030755`, draft
`faf11b6f-bf7f-4ad8-9f4e-61bae0e2261c`, trace `AV0qQKsugcBE0TibyVrynl2`) —
"Similar Pages" (40 engagement audiences) was rejected, salvaged (11 dropped
via the availability check), retried with the remaining 29, and Meta rejected
THAT too (a second, different batch of stale ids among the 29 survivors); the
ladder had no second pass and hard-failed. Numbered task #123 in code comments
(task #122 was PR #756's own three-way fix).

**FIX 1 — loop the 1359207 salvage (max 4 passes).** Wrapped the single
recovery+retry attempt in `launch-campaign/route.ts`'s Phase 2 in a bounded
`for` loop. Each pass re-runs the exact same decision logic PR #756 already
had (parse named ids from the error → fall back to a fresh
`fetchCustomAudienceAvailability` call, overlaid with the FIX-1-from-#756
readiness-wait outcome → `recoverFromDeletedCa`), retries with the reduced
payload, and — if THAT retry is itself rejected with 1359207 again and the
pass cap isn't hit — loops with the new error as the basis for the next
pass. Stops on success, on `recoverFromDeletedCa` reporting unrecoverable, on
a non-1359207 retry error, or on hitting the 4-pass cap (whichever comes
first). Logs each pass (`Phase 2 — "<name>" — CA salvage pass N/4, dropping M
audience(s): ...`) and the final ad set note lists the full cumulative set of
dropped ids across every pass, not just the last one.

**FIX 2 — preflight availability check for ad sets with a lot of reused
engagement audiences.** Added `preflightDropUnavailableAudiences` (pure,
`lib/audiences/ca-availability-recovery.ts`) plus `shouldRunPreflightAvailabilityCheck`
/ `REUSED_CA_PREFLIGHT_THRESHOLD` (= 20). Wired into `launch-campaign/route.ts`:
before the FIRST `createMetaAdSet` call, if an ad set targets ≥20 custom
audiences that were REUSED (not created fresh this launch run — freshly-created
ones are handled entirely by PR #756's `waitForAudienceReady` readiness wait,
a different problem), the route spends one batched `fetchCustomAudienceAvailability`
GET and drops anything already unavailable before ever submitting the payload.
A page_group that's been relaunched many times accumulates dozens of engagement
audiences, some of which will have aged out by any given relaunch — this
converts what would otherwise cost 1+ reactive FIX-1 salvage passes (a rejection
+ a retry, at minimum) into zero.

**FIX 3 — retry-failure + unrecognised-error logging.** Spent significant
effort trying to confirm from prod logs whether `isMissingAdvantageAudienceFlagError`
matched Meta's actual rejection of the "Wide" ad set at 21:11:21 UTC (see
"Design decisions" below — inconclusive, the Vercel MCP log viewer truncates
this one oversized multi-ad-set launch request before reaching Wide's outcome).
Code-level audit found no bug: `MetaApiError.subcode` is populated from Meta's
`error_subcode` field with no wrapping/loss between `graphPostWithToken`'s
throw and the route's catch block, and `isMissingAdvantageAudienceFlagError`'s
structure is identical to its two proven-working siblings
(`isInvalidTargetingAutomationError`, `isObjectiveIncompatibilityError`). Added,
regardless of root cause, two durability fixes so this exact ambiguity is
resolvable from logs alone next time: (1) every catch-chain retry handler
(the new looped 1359207 salvage, the 1870196 Advantage+-strip retry, the
1870227 advantage_audience-explicit retry) now logs its OWN failure distinctly
from a failed first attempt; (2) a new fallthrough diagnostic logs
`code`/`subcode`/`message` for any `MetaApiError` that no classifier
recognised, right before the final rethrow.

## Scope / files

- `lib/audiences/ca-availability-recovery.ts` — new `preflightDropUnavailableAudiences`,
  `shouldRunPreflightAvailabilityCheck`, `REUSED_CA_PREFLIGHT_THRESHOLD` (FIX 2);
  doc-comment update explaining the batch-reveal problem (FIX 1) and why
  `recoverFromDeletedCa` itself didn't need to change (still a stateless,
  one-shot decision function — the loop lives in the caller).
- `lib/audiences/__tests__/ca-availability-recovery.test.ts` — 9 new tests:
  2-pass sequential composition of `recoverFromDeletedCa` (the 3-attempt
  batch-reveal scenario) + an emptied-survivors unrecoverable case (FIX 1);
  4 direct `preflightDropUnavailableAudiences` tests + a 3-test
  threshold/drop integration group exercising `shouldRunPreflightAvailabilityCheck`
  and `preflightDropUnavailableAudiences` together (FIX 2).
- `app/api/meta/launch-campaign/route.ts` — Phase 2's 1359207 catch handler
  rewritten as a bounded 4-pass loop (FIX 1); new preflight check before the
  first `createMetaAdSet` attempt for ad sets with ≥20 reused custom
  audiences (FIX 2); retry-failure logging added to the 1870196 and 1870227
  handlers, plus a new unrecognised-error fallthrough log (FIX 3).

## Design decisions / deviations from the brief

- **FIX 3 could not be conclusively verified from prod logs.** Spent
  substantial effort querying the Vercel runtime-logs MCP tool
  (`get_runtime_logs`) for trace `AV0qQKsugcBE0TibyVrynl2` — confirmed the
  "Similar Pages" 1359207 double-rejection (validating FIX 1's reproducer
  exactly: first rejection → drop 11 via the availability check → retry →
  rejected again with 11 MORE stale ids among the 29 survivors → hard fail,
  matching the brief's prod-log line references), but the tool truncates
  this one oversized multi-ad-set-launch request at a fixed size (~1290
  lines / 82.7KB) regardless of query filter, and "Wide"'s create attempt —
  in a later batch, well past that boundary — was never reached. Confirmed
  via the `user-meta-ads` MCP's `list_ad_sets` that "Wide" (like "Similar
  Pages") does not exist on the live campaign, i.e. it genuinely failed, but
  couldn't pull the literal rejection subcode from logs to distinguish
  "classifier never matched" from "matched, retried, retry also failed."
  Code-level review found the classifier structurally sound (see FIX 3
  summary above), so shipped the logging durability fixes rather than
  guessing at a phrase/field change with no supporting evidence. Recommend
  the operator relaunch the v3 draft (or re-attach just "Wide") once this
  merges — the new logging will show definitively which case it was.
- **FIX 1's loop lives entirely in the caller, not `recoverFromDeletedCa`.**
  Kept `recoverFromDeletedCa` a stateless, one-shot decision function exactly
  as it was — looping is a caller-side retry-orchestration concern, and PR
  #756's session log already established the precedent (module dependency-free
  by design, no Graph calls, no loop state). This also matches the test
  strategy: the "3-pass batch reveal" scenario is tested by calling
  `recoverFromDeletedCa` twice in sequence with the previous pass's `keepIds`
  as the next `requestedIds` — exactly what the route's loop does — rather
  than trying to test the loop's control flow directly (not independently
  testable under `node --test`'s strip-only mode, same constraint documented
  for `lib/meta/client.ts` in PR #756's log).
- **FIX 2's preflight helper is a new function, not a `recoverFromDeletedCa`
  mode.** The two have different inputs (a real Meta refusal to interpret vs.
  a plain availability snapshot with nothing having failed yet) and different
  call sites (before vs. after `createMetaAdSet`) — sharing only the trailing
  keep/drop/label bookkeeping (both delegate to the module's private
  `labelList`). Threshold (20) and the boolean gate (`shouldRunPreflightAvailabilityCheck`)
  are exported from the same pure module as the drop logic so the "is this ad
  set big enough to bother" decision and the actual availability check share
  one source of truth and are testable together (the brief's "integration
  test... under the ≥20 threshold").
- **Multi-campaign (`MC[...]`) attach path intentionally NOT touched.** The
  route has a second, mostly-duplicate Phase 2 implementation for the
  multi-campaign bulk-attach flow (`app/api/meta/launch-campaign/route.ts`
  lines ~3600–3970) that already lacked PR #756's 1870227 fix entirely —
  same scope boundary PR #756 drew. The reproducer is a single-campaign
  standard launch; extending FIX 1/2/3 to the MC path is flagged as a
  follow-up, not silently skipped.
- **Task numbering:** #123 (next free after #122, PR #756's own numbering).
  Confirmed via `grep -rn "task #12[3-9]"` returning nothing before starting.

## Validation

- [x] `node --test` on the touched test file — 25 pass (16 pre-existing + 9
  new), 0 fail.
- [x] `npm test` (full suite) — 3570 tests (+9 vs. `main`'s 3561), 3553 pass,
  14 fail — identical failure count and identical failing tests as `main`
  before this branch (confirmed via `git stash` diffing both ways).
- [x] `npx tsc --noEmit` — 370 errors, identical count with and without this
  branch's changes (confirmed via `git stash`); zero errors in either file
  this PR touches.
- [x] `npx eslint` on every touched file — 0 errors; the 4 pre-existing
  warnings in `launch-campaign/route.ts` (unused imports/vars, same ones
  noted in PR #756's log) are unchanged.
- [x] `npm run build` — succeeds.
- [ ] Live relaunch of the IPC Newcastle draft — deliberately NOT performed
  per the operator's "do NOT relaunch live — operator will verify" instruction.

## Notes

- FIX 2's preflight check adds one Graph GET (shared batched call, same
  `fetchCustomAudienceAvailability` PR #756 already uses reactively) to any
  ad set with ≥20 reused custom audiences, on EVERY launch attempt regardless
  of whether anything has actually gone stale — a deliberate trade: one
  guaranteed cheap call beats a possible multi-pass reactive salvage loop.
- The 4-pass cap on FIX 1's loop is a safety valve, not a design target —
  if an ad set's audience list is stale enough to need 4 salvage passes,
  FIX 2's preflight check (once its ≥20 threshold is met) should catch most
  of that staleness on the FIRST attempt going forward, making back-to-back
  reactive passes rare in practice.
- Recommended follow-up once this PR is reviewed: relaunch the IPC Newcastle
  draft (or a fresh copy) live to confirm FIX 1/2 clear "Similar Pages" and to
  get a definitive read on "Wide" via the new FIX 3 logging.
