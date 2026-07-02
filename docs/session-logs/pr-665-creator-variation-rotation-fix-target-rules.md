# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creator/variation-rotation-fix-target-rules`

## Summary

Fixes a launch-blocking bug in PR #663's variation-rotation `asset_feed_spec`:
that PR shipped rotation payloads with **0** `asset_customization_rules`,
assuming "no rules = Meta rotates freely." Meta rejects this outright:

> The ad asset feed has 0 target rule(s) for format: INSTAGRAM_FEED_WEB, but
> exactly 1 target rule for this format is expected.

Prod evidence 2026-07-02: J2 Brighton launch hit the same error pattern as
Melodic. Meta requires ≥1 `asset_customization_rule` per placement format
even for pure Dynamic-Creative rotation. Fix mirrors the existing (working in
prod) `buildMultiPlacementCreative` 2-rule shape (Stories/Reels rule +
empty-spec catch-all default) but points every rule at a single **shared**
`"rotation"` adlabel across all N assets — so Meta is free to rotate any of
the N images/videos into any placement, rather than pinning one asset per
placement.

## Scope / files

- `lib/meta/creative.ts`:
  - New `ROTATION_LABEL = "rotation"` constant (shared across all N assets,
    unlike `FEED_LABEL`/`STORY_LABEL` which each pin one specific asset).
  - `buildVariationRotationCreative` now sets `adlabels: [{ name: ROTATION_LABEL }]`
    on every image/video entry and adds the 2-rule `asset_customization_rules`
    (Stories/Reels + catch-all), mirroring `buildMultiPlacementCreative`.
  - Diagnostic log extended to report `hasCustomizationRules`, `rulesCount`,
    `ruleCoverage` (`["stories_reels", "catch_all"]`), and `sharedLabel`.
  - `sanitizeCreativeForStrictMode`'s `asset_feed_spec` discrimination
    simplified: removed the now-dead `isVariationRotation` special case (spec
    with 2+ assets and no rules) since rotation payloads always carry rules
    now — they fall into the same `hasRules` → preserve branch as
    multi-placement payloads. Pure `hasRules` check restored.
  - `AssetFeedImage.adlabels` doc comment updated (was: "rotation omits
    adlabels entirely" — now inverted: rotation always sets it, kept
    `Optional` on the type only so lightweight Advantage+-auto-spec test
    fixtures don't need to set it).
- `lib/meta/__tests__/creative-variation-rotation.test.ts` — updated to
  assert the new 2-rule + shared-label shape instead of "no
  asset_customization_rules"; header comment documents both bugs (PR #663's
  variation[0]-only bug, and this follow-up's 0-rules bug).
- `lib/meta/__tests__/creative-buy-tickets-cta.test.ts` — updated the
  Single-mode + BUY_TICKETS rotation assertion to check for the 2-rule shape
  instead of "no rules".
- `lib/meta/__tests__/creative-multi-placement.test.ts` — untouched, still
  29/29 passing (dual-mode per-placement behaviour is unaffected — it
  already had rules).

## Regression coverage

- Dual mode (existing `buildMultiPlacementCreative`) uses **distinct**
  `FEED_LABEL`/`STORY_LABEL` per asset — completely separate code path and
  constants from the new shared `ROTATION_LABEL`, so no behavioural overlap.
- BOOK_NOW + N variations / BOOK_NOW + Dual mode fallbacks are untouched —
  they never reach `buildVariationRotationCreative` or
  `buildMultiPlacementCreative`'s AFS branch at all.
- Sanitizer simplification is provably safe: every payload that used to hit
  the removed `isVariationRotation` branch (rotation, no rules, 2+ assets)
  no longer exists after this fix (rotation payloads always have rules now),
  so the removed branch was dead code post-fix, not a behavioural change.

## Test plan

1. ✅ Single mode + 4 image variations → payload has 4 images, each with
   `adlabels: [{ name: "rotation" }]`, + exactly 2 `asset_customization_rules`
   (Stories/Reels spec + empty-spec catch-all), both rules referencing the
   shared label.
2. ✅ Single mode + 3 video variations → same shape with `video_label`.
3. ✅ Single mode + BOOK_NOW + N variations → unchanged fallback to
   variation[0] via single-asset path (no `asset_feed_spec`).
4. ✅ Single mode + 1 variation → unchanged single-asset path, no rules.
5. ✅ Regression: Dual mode + 1 variation → existing 2-rule per-placement
   pattern unchanged (distinct `STORY_LABEL`/`FEED_LABEL`, not
   `ROTATION_LABEL`).
6. ✅ Regression: BOOK_NOW + Dual mode → existing vertical fallback
   unchanged.
7. ✅ `npm run build`, `npm run lint`, `npx tsc --noEmit` — all clean, no new
   errors/warnings vs. baseline (362 tsc errors / 116 lint problems, both
   pre-existing and unchanged).
8. ⬜ Post-merge live test on Vercel Preview: relaunch J2 Brighton with 4
   variations + BUY_TICKETS CTA — not run this session (requires
   authenticated wizard access + a real Meta launch; see prior PR's session
   log for the same limitation).

## Validation

- [x] `npx tsc --noEmit` (362 errors before and after — no new errors)
- [x] `npm run build`
- [x] `npm run lint` (116 problems before and after — identical pre-existing set)
- [x] `node --test lib/meta/__tests__/creative-variation-rotation.test.ts lib/meta/__tests__/creative-multi-placement.test.ts lib/meta/__tests__/creative-buy-tickets-cta.test.ts` (35/35 passing)

## Notes

- This is the second fix-forward iteration on the variation-rotation feature
  (PR #663 shipped the feature with 0-rule AFS; this PR fixes the 0-rule
  rejection). Both prod incidents (Melodic, Brighton) trace to the same root
  cause — Meta's placement-format rule requirement wasn't validated against
  a real launch before #663 shipped.
- Live confirmation still pending: this fix is validated purely against
  Meta's documented/observed error message and the existing, proven-in-prod
  `buildMultiPlacementCreative` pattern. A live re-launch is the real proof
  and is called out as a follow-up in the PR.
