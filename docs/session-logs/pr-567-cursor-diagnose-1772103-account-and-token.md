# Session log — diagnose 1772103 (account + token + BM-asset)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/diagnose-1772103-account-and-token`

## Summary

Audit-only. Diagnoses the persistent Aberdeen 1772103 after PR #565, grounded in
live Graph API probes + the 21:41:51 production logs. **Root cause = BM-asset gap
(Thread 3):** @4thefansevents (`17841407313865620`) is linked to the 4thefans
Page but not added as an asset on the 4thefans ad account
(`act_10151014958791885`), so the validator's `/act_*/instagram_accounts` gate
returns an empty list with a *valid* token (HTTP 200) → `instagram_actor_id`
dropped → 1772103. Thread 1 (wrong account) and Thread 2 (token) are NOT the
cause — the wizard sent the correct account + IG, and the validator's token was
valid. The subcode-467 error is a separate, non-fatal stale-env-token issue in
Phase 1.5.

## Scope / files

- `docs/AUDIT_1772103_ACCOUNT_AND_TOKEN_2026-06-05.md` — full three-thread audit

## Key corrections to prior assumptions

- `act_932846012721428` (assumed 4thefans) is actually **Off / Pixel's own**
  account and the `.env` default — the #564/#565 curl "proofs" tested the wrong
  account.
- `1318484633042193` (assumed IG) is **not an IG account**.
- Correct 4thefans ids: ad account `act_10151014958791885`, IG
  `17841407313865620` (@4thefansevents).

## Validation

- [x] Live probes confirm account names, IG identity, page-level link, and empty
  BM-asset list
- [x] Code trace confirms validator token (valid) vs Phase 1.5 env token (stale)

## Notes

- Fix (follow-up): the deferred page-level fallback from PR #565 — gate on a
  page-token-validated actor when the BM-asset list is empty, handling the
  b57a98e #100 caveat.
- Memory `project_creator_ig_actor_validated_readd_2026-06-05` should record that
  the root cause is the BM-asset gap (not prefix/account/token).
