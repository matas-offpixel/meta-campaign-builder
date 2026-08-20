# Session log

## PR

- **Number:** 804
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/804
- **Branch:** `cursor/tiktok-campaign-name-collision`

## Summary

Two mid-flight launch failures left `[IRW0001] Jamie Jones -sig` taken on advertiser 7639802149165301776. Preflight now lists existing campaign names via `/campaign/get/` and blocks before any write. 40002 "Campaign name already exists" maps to a Step 2 rename (suggested suffix keeps `[EVENT_CODE]`). Campaign cleanup logs `outcome=deleted` or `outcome=failed` with the campaign id.

## Scope / files

- `lib/tiktok/write/campaign-names.ts` — fetch, suggest, collision message
- Preflight + launch + error-classify + cleanup logging

## Validation

- [x] `npm run build`
- [x] `npm test` — 3981 = 3965 passed + 13 failed + 3 skipped (13 pre-existing; +1 vs #804 for the 40002-is-not-auth fixture)
- [x] eslint on changed files clean

## Notes

Rollback: `cleanupTikTokCampaign` does call `/campaign/delete/` (tests confirm the path). Errors were previously only `console.warn` and easy to miss. Two live failures left the name taken after rollback, which is consistent with either a silent delete failure or TikTok reserving names after delete. If the next failed launch logs `outcome=deleted` and the name is still taken, retry means rename — not a second launch of the same name.

Did not change OFFPIXEL_TIKTOK_WRITES_ENABLED, paused create, identity/budget preflight, or Meta.

## Follow-up (2026-08-21): 40002 is not auth

`AUTH_CODES` incorrectly included 40002. That code is TikTok's generic parameter-validation error. Three live launches tonight all returned 40002 and none were auth:

- "Your budget setting must not be less than £50"
- "Identity_type and Identity_bc_ID don't match"
- "Campaign name already exists. Please try another one."

All three rendered as "TikTok connection is invalid (40002)", which pointed operators at reconnecting OAuth. 40002 now falls through to the `other` branch and surfaces `TikTok error 40002: <TikTok's own message>`. The name-collision special case still matches on message text before code classification.

The Meta side has the same class of bug open as task #95 — the "app in Development mode" mapper is too broad and mislabels unrelated Meta errors. Same lesson: an error mapper that guesses a cause is worse than one that passes through the vendor's own message. Do not fix the Meta one in this PR.
