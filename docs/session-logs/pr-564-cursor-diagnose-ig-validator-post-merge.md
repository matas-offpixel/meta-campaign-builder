# Session log — diagnose IG validator post-merge regressions (audit-only)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/diagnose-ig-validator-post-merge-regression-audit-only`

## Summary

Audit-only PR diagnosing two regressions reported after PR #563. **Symptom 1**
(1772103 still failing): a NEW #563 bug — `lib/meta/ig-actor-validator.ts`
hand-rolls `act_${adAccountId}` while the stored id already carries the `act_`
prefix, so it requests `/act_act_{id}/instagram_accounts` → HTTP 400 → validator
returns null → `instagram_actor_id` omitted → 1772103. Proven against the live
Graph API (200 single-prefix vs 400 double-prefix) and the actual production
launch logs. **Symptom 2** (slow Page dropdown): #563 exonerated — the validator
never runs in the dropdown / page-identity path and #563 touched no file there;
the latency is pre-existing in `/api/meta/pages`.

## Scope / files

- `docs/AUDIT_IG_VALIDATOR_POST_MERGE_2026-06-05.md` — full audit with artefacts + fix proposal
- `lib/meta/__tests__/ig-actor-validator-prefix-regression.test.ts` — RED test (double-prefix); fix lands in a follow-up branch

## Validation

- [x] RED test confirmed failing on current main (URL = `act_act_932846012721428`)
- [x] Root cause proven via live Graph API + production runtime logs (no speculation)

## Notes

- Fix (follow-up branch): use `withActPrefix(adAccountId)` in the validator;
  verify the BM-asset endpoint contains the 4thefans agency-linked IG id or add a
  page-level fallback (see audit "Fix proposal").
- Optional perf follow-up: dedupe the two `fetchBusinessIdForAccount` calls in
  `/api/meta/pages`.
