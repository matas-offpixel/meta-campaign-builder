# rewire.test.ts: separate the rule, the freeze and the lock

## PR

- **Number:** 972
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/972
- **Branch:** `cursor/rewire-test-freeze`

## Summary

One test in `lib/db/__tests__/rewire.test.ts` held three different things: an architectural rule (rewire must not import the optimisation decision engine), a change-freeze on `evaluate.ts` / `apply.ts` / `gates.ts` expressed as "not in this branch's `git diff`", and a coordination lock on `components/plan/`. The rule stays, in its own `it()`. The freeze is replaced by assertions on what those files do: golden wire payloads for `apply.ts` and a full gate truth table for `gates.ts`. The lock is deleted; coordination belongs in prompt guards, not in a test that fails any unrelated branch.

## Scope / files

- `lib/db/__tests__/rewire.test.ts` — four content tests verbatim; new "rewire does not reach into the optimisation decision engine"; new self-check that no test in the file asserts against a branch diff; `execSync` import gone.
- `lib/optimisation/__tests__/write-payloads.test.ts` + `fixtures/optimisation-write-payloads.json` — six `applyOptimisationOrPause` cases (ABO scale-up, CBO scale-down, pause reduced to floor, paused at floor, pause with fourth gate closed, scale-up shadow). Each compares the Graph request (`method`, `path`, `body`, built in the route's exact shape) and the outcome byte-for-byte against committed JSON. A route check pins the three `graphPostWithToken` lambdas in `app/api/cron/optimisation-tick/route.ts`.
- `lib/optimisation/__tests__/gates.test.ts` — 16-combination table over `ENABLE_OPTIMISATION_WRITES` × `optimisation_automation_enabled` × `optimisation_automation_live` × `ENABLE_OPTIMISATION_PAUSE_WRITES`.

No source file changes. `evaluate.ts`, `apply.ts`, `gates.ts`, and the route are untouched.

## Validation

- [x] Golden matched on first run — no drift in the optimisation write path.
- [x] Mutation: `apply.ts` pause floor changed to `floor - 1` → `pause_reduced_to_floor` fails with `{"daily_budget":4999}` vs `5000`. Reverted.
- [x] A change under `components/plan/` → `rewire.test.ts` 6/6 pass.
- [x] `npm test` — 6206 pass, 0 fail.
- [x] `npm run build`

## Notes

- Thirteen `AutomationAction`s: all asserted where produced. `metric_unavailable` and `skip_no_rules` come from `tick-runner.ts`, not `evaluate.ts`, and are covered by `cbo.test.ts` and `tick-runner.test.ts`. No uncovered branch found.
- `lib/__tests__/campaign-event.test.ts:321` still has a diff-against-main freeze, gated to the long-merged branch `cursor/duplicate-must-choose-its-event` (so it early-returns everywhere else). Out of scope here; worth deleting in its own PR.
