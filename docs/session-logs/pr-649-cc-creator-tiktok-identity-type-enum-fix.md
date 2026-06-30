# Session log — TikTok identity type enum fix

## PR

- **Number:** 649
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/649
- **Branch:** `cc/creator/tiktok-identity-type-enum-fix`

## Summary

Removed the invalid `PERSONAL_HUB` identity type from the TikTok wizard and replaced it with the four values TikTok's API actually accepts: `AUTH_CODE`, `BC_AUTH_TT`, `CUSTOMIZED_USER`, `TT_USER`. BC_AUTH_TT is iterated first so BC-linked identities win last-write in the merge Map. This unblocked the identity dropdown for Ironworks (and all Off Pixel TikTok clients) which was empty because every API call was being rejected by TikTok for using `PERSONAL_HUB`.

## Scope / files

- `lib/tiktok/identity.ts` — updated `TikTokIdentityType` union and `IDENTITY_TYPES` iteration array
- `lib/types/tiktok-draft.ts` — updated `TikTokAccountSetup.identityType` union (kept `"MANUAL"` and `null`)
- `components/tiktok-wizard/steps/account-setup.tsx` — updated local `TikTokIdentityOption.identity_type` union
- `lib/tiktok/__tests__/identity.test.ts` — replaced stale `PERSONAL_HUB`-based assertions with correct 4-type assertions

## Validation

- [x] `npm run build` → exit 0
- [x] `npm run lint` (touched files) → clean
- [x] `node --test lib/tiktok/__tests__/identity.test.ts` → 1 pass, 0 fail
- [x] `grep -rn "PERSONAL_HUB" --include="*.ts" --include="*.tsx" --include="*.sql"` → 0 matches

## Notes

- No migration required: `identity_type` is a plain `TEXT` column in migration 106 with no CHECK constraint.
- Manual identity override UI and route are untouched — the `"MANUAL"` value and `identityManualName` field remain intact.
- TikTok write API path (`OFFPIXEL_TIKTOK_WRITES_ENABLED`) is untouched.
- `lib/tiktok/share-render.ts` is untouched (owned by Creator+Reporting thread).
