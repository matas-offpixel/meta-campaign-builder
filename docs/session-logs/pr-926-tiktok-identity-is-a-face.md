# Session log

## PR

- **Number:** 926
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/926
- **Branch:** `cursor/tiktok-identity-is-a-face`

## Summary

#924 restored the TikTok ladder, so `useIsDrawer()` went false on `/tiktok-campaign/[id]` and the BC_AUTH_TT hatch dumped its three manual fields onto the Account step. The hatch is an escape hatch on every surface now: collapsed unless the identity failed, came back empty, or still needs a type. The identity picker shows the profile — avatar, then display name. Type stays a muted caption. Advertiser has no visual in the payload, so that row stayed text.

**Round 2:** the live Ironworks `/identity/get/` row has no `avatar_url`. The face lives on `profile_image`. `extractIdentityAvatar` walks `profile_image` then `avatar_url`, same shape as the BC-id candidates. Ironworks will render that CDN face, not the `I` chip.

## Scope / files

- `components/tiktok-wizard/steps/account-setup.tsx` — hatch no longer branches on drawer; identity picker is a face
- `lib/tiktok-wizard/account-setup.ts` — `shouldOpenManualIdentityHatch`, `tikTokIdentityFace` / option view
- `lib/tiktok-wizard/__tests__/account-setup.test.ts` — hatch collapsed on both surfaces; auto-open on unresolved; avatar vs chip
- `lib/tiktok/identity.ts` — `IDENTITY_AVATAR_CANDIDATE_KEYS` / `extractIdentityAvatar` (round 2)
- `lib/tiktok/__tests__/identity.test.ts` — fixture from the captured raw row (round 2)

Did not touch: the three drawers, pixel / optimisation-event / selected-advertiser, `identityId` / `identityType` / `identityManualName` persistence, `lib/tiktok/write/**`, `OFFPIXEL_TIKTOK_WRITES_ENABLED`, `next.config`. Hatch left as round 1.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5457 pass, 4 skipped)
- [x] `frames:check` — no frame file touched, no baselines regenerated. Local Darwin rasters differ from Ubuntu baselines (same as #921–#925). No frame renders the Account step.

## Notes

Remote avatars use the same plain `<img>` + `eslint-disable-next-line @next/next/no-img-element` as `page-audiences-panel` and `creatives`. `next.config` has no `images` / `remotePatterns` block; this PR does not add a TikTok CDN pattern because it does not introduce `next/image`.

`TikTokAccount` carries `account_name` and `tiktok_advertiser_id` only — no avatar, logo, or image URL. The advertiser row is unchanged.

Live key used: **`profile_image`**. Envelope data keys: `identity_list`, `page_info`.
