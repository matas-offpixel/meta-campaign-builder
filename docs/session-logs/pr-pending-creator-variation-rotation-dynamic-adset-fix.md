# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/variation-rotation-dynamic-adset-fix`

## Summary

Fixes variation rotation so uploading N images/videos to a single wizard "creative"
actually rotates in Meta delivery. Root cause: we sent an `asset_feed_spec` at the
creative level but never set `is_dynamic_creative:true` at the ad set level, so Meta
silently degraded the multi-asset creative to a single asset. PR #665's shared-adlabel
+ `asset_customization_rules` workaround was structurally wrong (Placement Asset
Customization shape misused for rotation, rejected subcode 1885878). This PR ships the
correct Dynamic-Creative payload shape AND opts the ad set into Dynamic Creative.

## Scope / files

- `lib/meta/creative.ts` — rewrote `buildVariationRotationCreative`: `images`/`videos`
  now carry ONLY `{hash}` / `{video_id}(+thumbnail)` — no adlabels, no
  `asset_customization_rules`, no `optimization_type`. Removed the `ROTATION_LABEL`
  constant. Exported `detectVariationRotation` and added
  `creativeTriggersVariationRotation` (mirrors `buildCreativePayload` routing incl.
  flag gate + BOOK_NOW skip). Updated `sanitizeCreativeForStrictMode` so a rules-less
  Dynamic-Creative rotation spec (≥2 assets) is **preserved** — otherwise Creative
  Integrity Mode (default ON) would strip the spec and silently defeat the fix; a bare
  auto spec (no rules, <2 assets) is still stripped.
- `lib/meta/adset.ts` — `buildAdSetPayload` takes an optional
  `hasVariationRotationCreative` flag; when true sets `payload.is_dynamic_creative = true`
  (field OMITTED entirely otherwise — never sent as `false`). Added a Vercel log beacon.
- `app/api/meta/launch-campaign/route.ts` — before any Meta mutation, plans dynamic ad
  sets: flags every ad set that has a variation-rotation creative assigned (passed to all
  6 `buildAdSetPayload` call sites — Phase 2, Phase 2 retry, Phase 2b lookalike, and the
  three multi-campaign equivalents). Enforces the Meta rule that a dynamic ad set carries
  AT MOST ONE ad: a dynamic ad set with >1 assigned creative fails fast with a clear 400.
  (We do not auto-split, because cloning an ad set would duplicate its daily budget — an
  unsafe silent side effect; the operator moves the extra creatives to their own ad set.)
- `lib/meta/__tests__/creative-variation-rotation.test.ts` — updated for the new shape
  (no adlabels / no rules / no optimization_type; strict-mode preservation) + regression
  guard that fails if the shared-label / rules pattern returns.
- `lib/meta/__tests__/adset-dynamic-creative.test.ts` — NEW: asserts the flag sets
  `is_dynamic_creative:true` and is OMITTED (not `false`) otherwise.

## Validation

- [x] `npm run build` — exit 0
- [x] `npm run lint` — clean on touched files (only pre-existing unused-var warnings)
- [x] `node --test lib/meta/__tests__/creative-variation-rotation.test.ts` — 17 pass
- [x] `node --test lib/meta/__tests__/adset-dynamic-creative.test.ts` — pass

## Notes

- Grep: `is_dynamic_creative` was **0** occurrences before, **12** after (across
  `lib/meta/creative.ts`, `lib/meta/adset.ts`, `app/api/meta/launch-campaign/route.ts`,
  and the two test files).
- Meta MCP probe (2026-07-02, account 10151014958791885): the H1 payload
  (`images[{hash}]` + bodies + titles + link_urls + call_to_action_types + ad_formats,
  NO adlabels, NO asset_customization_rules) reached the ad-set-level check and was
  rejected only because the target ad set already had ads (error 1885553) — confirming
  the payload shape is valid.
- Manual smoke test (post-merge, PENDING): Matas launches a 4-image variation ad via the
  wizard into a J2 or 4TheFans traffic campaign; Meta Ads Manager should show the ad as
  Flexible/Dynamic Creative with all 4 assets in the ad's Variations panel.
- Follow-up: auto-splitting a multi-creative dynamic ad set (with correct budget
  handling) instead of failing fast.
