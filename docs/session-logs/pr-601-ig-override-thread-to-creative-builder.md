# Session log — IG override thread to creative builder

## PR

- **Number:** 601
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/601
- **Branch:** `cc/ig-override-thread-to-creative-builder`

## Summary

PR #600 stored `pageInstagramOverrides` and respected them in Phase 1.5 `pageToIg`, but Phase 3 built `object_story_spec.instagram_user_id` from `creative.identity.instagramActorId` — still auto-resolved to the wrong IG (@ionfestival). This PR threads operator picks into both `instagramAccountId` and `instagramActorId` on the client, re-applies overrides on the launch route before payload build, and short-circuits the IG actor validator for operator picks.

## Audit findings

- `buildCreativePayload` sets `instagram_user_id` from `validatedIgActorId`, which comes from `instagramActorId` (not `instagramAccountId`).
- `creatives.tsx` page-identity effect overwrote `instagramActorId` with `igActorId` from page-identity even when override was set on `instagramAccountId` only.
- Phase 1.5 `pageToIg` is engagement-audience only; new-ad path never read overrides.
- `useCreateCreativesAndAds` is a thin fetch wrapper — no override logic (wizard launch uses `/api/meta/launch-campaign`).

## Scope / files

- `lib/meta/apply-page-instagram-overrides.ts` — shared apply helper
- `lib/meta/ig-actor-validator.ts` — operator override short-circuit
- `app/api/meta/launch-campaign/route.ts` — preflight + Phase 3 enforcement + audit logs
- `components/steps/creatives.tsx` — actor id sync; block identity hook overwrite
- `components/wizard/wizard-shell.tsx` — audiences override → creatives sync
- `components/steps/audiences/audiences-step.tsx` — `onPageInstagramOverride` prop

## Validation

- [x] `npm run build`
- [x] `node --test lib/meta/__tests__/ig-actor-validator.test.ts`
- [ ] Preview: Junction 2 Fragrance attach_adset + LWE + @l_w_e → no @ionfestival rejection
- [ ] Prod relaunch verification (Matas)

## Notes

Follow-up to PR #600.
