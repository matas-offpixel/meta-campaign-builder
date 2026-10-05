# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/account-preflight-scope-by-mode`

## Summary

Attach-to-ad-set launches were refused for audiences the wizard never sends. The account-scope preflight now checks audiences only when the launch creates ad sets (`new`, `attach_campaign`). Image and video checks still run in every mode. A mismatch is one summarised sentence, the 400 is marked `source: "preflight"`, and the Review error panel stays capped so Launch remains on screen.

## Scope / files

- `lib/meta/account-scope-preflight.ts` — skip the audience leg in `attach_adset` / `attach_all_adsets`
- `lib/audiences/audience-account.ts` and `lib/meta/asset-account-preflight.ts` — one sentence, at most three names
- `lib/validation.ts` — foreign audience is a warning, not an error, in those attach modes
- `app/api/meta/launch-campaign/route.ts` — 400s carry `source: "preflight"`, 502s `source: "meta"`
- `components/steps/review-launch.tsx` — capped panel, Copy, preflight lead sentence

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build` (when applicable)
- [x] `npm test` (when applicable)

## Notes

Account display names are parenthetical only when `/me/adaccounts` resolves them. A failed name lookup still refuses, with the account ids and no names.
