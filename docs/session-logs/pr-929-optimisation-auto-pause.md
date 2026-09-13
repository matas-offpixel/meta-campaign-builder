# Session log

## PR

- **Number:** 929
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/929
- **Branch:** `cursor/optimisation-auto-pause`

## Summary

The optimisation loop could scale budgets on its own and could not stop on its own. Pause is now a fourth-gated write: `ENABLE_OPTIMISATION_PAUSE_WRITES` on top of the existing three, reduce to `pauseFloorBudget` before any terminal pause, and three blast-radius limits (never the last active ad set, two pauses per run, 15-conversion minimum). Shipping the flag unset is the point. Never auto-resume.

Round 2: the floor cut sat above those three guards and spent the generic write budget. Conversion minimum, last-active, and the pause cap now run first. Campaign-wide is a majority of the same delivering set. Floor cuts draw from the two-pause budget.

Round 3: rebased onto `fc5e93c` (#935). The pause ladder was re-derived against #933's build/apply split, not hunk-picked. CI jobs that had failed to attach on `a9dab0d` attached on the fresh push.

This pass: `applyOptimisationDecision` is byte-identical to main; live pause lives in `applyOptimisationOrPause`. Cooldown rows carry `censusDecision` / `applyDecision: null`. The shared cap is `pauseLadderWrites`. Floor cuts fire `ads_urgent` but stay out of the end-of-run `ads_automation` digest.

## Scope / files

- `lib/optimisation/gates.ts` — `optimisationPauseDryRunGates` + env reader; 3-of-3 table unchanged. Tick-runner calls this helper.
- `lib/optimisation/apply.ts` — `applyOptimisationOrPause` wrapper; `applyOptimisationDecision` untouched vs main
- `lib/optimisation/tick-runner.ts` — `censusDecision` / `applyDecision`; eligibility first; same-set census including cooldown; stops before cheapest-first scale-ups; `pauseLadderWrites`; floor/pause do not credit #933 headroom
- `app/api/cron/optimisation-tick/route.ts` — wires fourth gate + `pauseAdSet` (`status: "PAUSED"` only)
- `lib/optimisation/insights-fetch.ts` — `effective_status` comment; `start_time` / yesterday field from main kept
- `lib/types.ts` — optional `pauseFloorBudget` (JSON guardrail, no migration) alongside #933 ceiling fields
- `lib/optimisation/evaluate.ts` — `GuardrailNote` union only; decision logic untouched
- `lib/plan/__tests__/drawer.test.ts` — freeze allow-lists only the pause path, the fourth gate, and their exports
- `CLAUDE.md`

## Rebase decisions (onto #933 / #931 / #935)

| Question | Decision |
|---|---|
| Does a floor cut return pence to #933's in-tick headroom? | No. `applyCampaignHeadroom` already returns `usedPence: 0` on a non-scale-up. We do not add the cut back. Headroom stays conservative. |
| Does a pause return headroom? | No. A stop is not a gift to siblings. |
| Which pass runs first? | Eligibility (#931) before anything. Then apply **stops first** (`pause` / floor / `scale_down` / `maintain` in `rest`), then #933's cheapest-metric-first scale-ups. A stop should land before a raise in the same tick. |
| `skip_campaign_ended` vs the pause ladder | Named eligibility skips still run before `evaluate()` / the census. An ended campaign is never floor-cut or paused. |
| `#935` `nameEmptyMatchingLadder` | Sits between evaluator and row. Empty bands rewrite `maintain`+`ruleMatched: null` to `skip_no_rules`. A ladder with no bands cannot produce `pause`. Confirmed with a fourth-gate-open checkout fixture. |
| ROAS-secondary hazard | Closed on main by #935. Checkout primary is `cpic`; the tick only resolves the objective's primary. A stray `roas < 0.8 → pause` is unreachable. |

## Review round 2 — now pinned

| Finding | File | Test that pins it |
|---|---|---|
| Campaign-wide must count `activeCount` and `pauseCandidates` over the same set | `tick-runner.ts` census over eligibility-cleared delivering rows, including cooldown (evaluate with `lastTouchedAt=null` so a recent touch is still a pause candidate) | `cooldown on one breacher still counts in the same-set majority — no floor, no pause` |
| `optimisationPauseDryRunGates` must be the function production calls | `tick-runner.ts` + cron route | `the tick runner and the cron route call the helper, not a sibling` |

## Review round 3 — fixed

| Finding | File | Test that pins it |
|---|---|---|
| Freeze sliced `applyOptimisationDecision` from `if (!wouldWriteBudget`, one statement below the pause insert | `apply.ts` — `applyOptimisationOrPause` wrapper; `applyOptimisationDecision` restored byte-identical to main | freeze: `extractNamedFunction(…, "applyOptimisationDecision")` equals `origin/main` |
| Empty-diff early return and a per-file loop that could not fire | `lib/plan/__tests__/drawer.test.ts` | empty diff now fails; the loop is gone |
| Allow-list named `MAX_PAUSES_PER_RUN` / `MIN_PAUSE_CONVERSION_RESULT_COUNT` without asserting 2 and 15 | same + `apply.ts` | `assert.equal(MAX_PAUSES_PER_RUN, 2)` and the source literals |
| Cooldown census shared one `decision` object; containment was `filter(!onCooldown)` | `tick-runner.ts` `censusDecision` / `applyDecision: null` on cooldown | `a cooldown breacher is not persisted and receives no Meta call` |
| `pausesApplied` counted floor cuts | `pauseLadderWrites` | floor-cut test asserts `pauseLadderWrites === 2` and `pauses.length === 0` |
| `>= 1` on a fixture of two; leftover identical ternary | tick-runner pause tests | `pausesRecommended === 2`; `readAdSetDailyBudget: async () => 10000` |
| Missing `pauseAdSet` seam writes a silent non-dry-run row | `apply.ts` | `a missing pauseAdSet seam persists a silent non-dry-run failure` |
| Campaign-wide formula only tested either side of the cut | `isCampaignWidePauseBreach` | `the boundary itself is pauseCandidates * 2 > activeCount` |

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test`
- [x] Freeze: `applyOptimisationDecision` is byte-identical to main; new exports are the wrapper, the pause path, the fourth gate; `MAX_PAUSES_PER_RUN === 2`, `MIN_PAUSE_CONVERSION_RESULT_COUNT === 15`; no `status: ACTIVE` write
- CI conclusions reported in the review reply (not local counts)

## Notes

- `ENABLE_OPTIMISATION_PAUSE_WRITES` is not set anywhere. Do not enable it in this PR.
- `ENABLE_OPTIMISATION_WRITES` unchanged and live.
- `evaluate.ts` ceiling / `maxDailyIncreasePercent` clamps do not apply to the floor cut. Intended: the floor is a configured stop, not a scale-down through the ladder.
- `effective_status` is on the ad-set Graph field list and mapped onto every insight row. Missing status is not delivering; that also blocks the floor cut (`active <= 1`).
- Slack: `SLACK_WEBHOOK_ADS_URGENT` is now configured. One live check that a message arrives belongs before the flag is flipped, not before merge.
- No auto-resume. `status: "ACTIVE"` appears in neither `apply.ts` nor the tick route.
- `components/plan/**` untouched. Zero new frame baselines.
