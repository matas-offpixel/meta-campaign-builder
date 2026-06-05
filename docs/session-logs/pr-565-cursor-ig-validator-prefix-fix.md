# Session log — IG validator double-prefix fix

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/ig-validator-prefix-fix`

## Summary

Fixes the `act_act_` double-prefix bug in `lib/meta/ig-actor-validator.ts`
diagnosed by PR #564. The validator hand-rolled `act_${adAccountId}` on an
already-prefixed id, requesting `/act_act_{id}/instagram_accounts` → Graph HTTP
400 → validator returned null → `instagram_actor_id` dropped → Meta 1772103.
One-line fix: use the idempotent `withActPrefix(adAccountId)` helper. Confirmed
the fixed URL returns HTTP 200 against the live Graph API.

## Scope / files

- `lib/meta/ig-actor-validator.ts` — use `withActPrefix`; add a temporary URL
  debug log (token redacted, `console.error`) with a dated TODO to remove
- `lib/meta/__tests__/ig-actor-validator-prefix-regression.test.ts` — from PR
  #564 (now GREEN); added a test asserting exactly one `/act_` segment
  (`/\/act_(?!act_)/`)

## Validation

- [x] Prefix regression test RED→GREEN
- [x] New single-`/act_`-segment test passes
- [x] All validator + IG-identity tests pass (18 total)
- [x] Live Graph API: fixed URL `/act_{id}/instagram_accounts` → HTTP 200
- [x] No lint errors

## Notes

- Per request: NO BM-asset-vs-page-level fallback added (4thefans is
  direct-linked; defer until a real agency-linked client hits it).
- Did NOT touch the slow Page dropdown (separate perf PR; #564 exonerated #563).
- Post-merge: relaunch the 3 Aberdeen WC26 ad sets, capture the wire payload, and
  confirm `instagram_actor_id = 1318484633042193` is present and no
  `[buildCreativePayload] IG actor validation failed` line fires. Then drop the
  temporary URL log (TODO 2026-06-12).
