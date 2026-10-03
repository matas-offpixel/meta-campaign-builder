# Session log

## PR

- **Number:** 1011
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1011
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
- `lib/meta/location-radius.ts` — ceiling 80 km / 50 mi; radius 0 is no radius; subcode 1487110
- `lib/meta/__fixtures__/account-scope/` — captured Graph responses

## Validation

- [x] `npm run build`
- [x] `npm test` (6602 pass, 4 skipped)
- [ ] `npx tsc --noEmit` — still fails on pre-existing test-file errors; the build is the typecheck

## Notes

Fixtures, both on Electric Studios (`act_1073273492854557`): custom audience `120250867495400239` (`account_id` `1073273492854557`, "Main Phase  IG Engagement 365d"). The adimages fixture is a live two-page read of that account with `limit=1`: page 1 hash `b7a997f09b47f16d684c7a147190d275`, page 2 hash `f55a2b19688745a0745d1462d2a9e6d3` via `paging.next`. The access token was removed from the paging URLs.

A video with no `creative_asset_channel_ids` row is allowed, unverified, and logged as `["account-scope-preflight"] video {id} unverified`. It is not refused. The registry landed on 26 Aug (migration 161), so a Meta video draft from before then has no row. An imported video sets `videoId` and does not record a channel id. `register()` can return undefined. A launch by a different operator than the uploader used to miss the row because the read filtered `user_id`; that filter is gone, because the scope is the ad account. A row whose scope is a different account is the refusal. A thrown audience batch or adimages read is also unverified and does not refuse; only a successful read that proves a mismatch refuses. The post-create audience refusal (the one that said the campaign was created and nothing was added) is gone.

No capture documents a Meta floor on city radius, so there is no minimum in the picker. 0 and an omitted radius are no radius. The ceiling stays 80 km / 50 mi. A 1487110 whose text says the radius is too small uses its own sentence; the captured "isn't within the specified bounds" message stays the ceiling sentence. An account switch keeps `registryAssetId` (the Storage row is not Meta-scoped) and clears only the Meta ids. The multi-city fixture's Newcastle radius is stored as 80 km so the budget check does not fail that suite; its label still says "+200 km" because ad set names are parsed from the label.
