# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/account-switch-invalidation`

## Summary

Switching the ad account on a draft used to keep the previous account's image hashes, video ids, and audience ids, and launch then failed on the new account. A confirmed switch now clears those draft fields (nothing is deleted on Meta). Launch refuses an audience or image that still belongs to another account before any create, and a city radius above Meta's 80 km / 50 mi cap is blocked in the budget step.

## Scope / files

- `lib/wizard/account-switch.ts` — confirm/cancel draft transform
- `components/steps/account-setup.tsx` — confirm dialog; wizard and plan drawer apply the full draft
- `lib/audiences/audience-account.ts` — `account_id` compared to the draft account; "⚠ belongs to act_… — rebuild"
- `app/api/meta/audience-accounts/route.ts` — one batched read for the audiences step
- `lib/meta/account-scope-preflight.ts` — launch refusal before any POST
- `lib/meta/asset-account-preflight.ts` — adimages hash set and video registry set
- `lib/meta/location-radius.ts` — 1–80 km / 1–50 mi; subcode 1487110
- `lib/meta/__fixtures__/account-scope/` — captured Graph responses

## Validation

- [x] `npm run build`
- [x] `npm test` (6587 pass, 4 skipped)
- [ ] `npx tsc --noEmit` — still fails on pre-existing test-file errors; the build is the typecheck

## Notes

Fixtures, both on Electric Studios (`act_1073273492854557`): custom audience `120250867495400239` (`account_id` `1073273492854557`, "Main Phase  IG Engagement 365d") and ad image hash `b7a997f09b47f16d684c7a147190d275`. Paging cursors were left out of the adimages fixture. A missing creative-asset registry table does not fail the video check (the registry's existing contract); a successful read with no row for this account does refuse. The multi-city fixture's Newcastle radius is stored as 80 km so the new budget check does not fail that suite; its label still says "+200 km" because ad set names are parsed from the label.
