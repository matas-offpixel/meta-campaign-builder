# Session log — ig-actor-validator page-level fallback

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/ig-validator-page-level-fallback`

## Summary

Adds a page-level IG actor fallback to `createIgActorValidator` so that agency
clients whose Instagram account is linked to their Facebook Page but not
registered as a BM asset on the ad account (the 4thefans WC26 root cause
identified by PR #567) can still launch ads with `instagram_actor_id` resolved.

Resolution order: BM-asset list → page-level `/{pageId}/instagram_accounts`
(page token) → null (b57a98e protection). Both launch routes pre-resolve page
tokens once per unique page and pass them through to `validate()`.

## Scope / files

- `lib/meta/ig-actor-validator.ts` — added `ValidateOpts`, `fetchPageIds`,
  page-level fallback in `validate()`, result log `via=bm-asset|page-level|none`
- `app/api/meta/launch-campaign/route.ts` — page-token pre-resolution loop
  before Phase 3 creative loop; `validate()` now called with `{ pageId, pageToken }`
- `app/api/meta/bulk-attach-ads/route.ts` — same page-token pre-resolution;
  added `resolvePageIdentity` import
- `lib/meta/__tests__/ig-actor-validator.test.ts` — 12 tests covering all paths
  including the 4thefans scenario and b57a98e protection

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files
- [x] `node --test lib/meta/__tests__/ig-actor-validator.test.ts` — 12/12 pass
- [x] `node --test lib/meta/__tests__/ig-actor-validator-prefix-regression.test.ts` — 3/3 pass
- [ ] Vercel green
- [ ] Aberdeen relaunch: `[ig-actor-validator] resolved via=page-level page=202868440480679 ig=17841407313865620`

## Notes

- Post-merge: remove the two TODO(2026-06-12) temporary log blocks added by
  PR #565 (URL log in `fetchBmIds`) and PR #566 (`[IG_VALIDATOR_RESULT]` in
  launch-campaign). They are still useful for the Aberdeen relaunch to confirm
  end-to-end, then can be dropped in a hygiene PR.
- The `token` variable in `bulk-attach-ads` is the user's OAuth token (from DB
  or `META_ACCESS_TOKEN` env fallback) — same token that `resolvePageIdentity`
  uses in launch-campaign via `userFbToken`. This is correct: page identity
  resolution requires a user token, not a system token.
