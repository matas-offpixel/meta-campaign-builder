# Session log — cursor/diag-561-dual-image-1772103

## PR

- **Number:** 562
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/562
- **Branch:** `cursor/diag-561-dual-image-1772103`

## Summary

Diagnosis-only investigation of dual-image launches failing with Meta
`code=100 subcode=1772103`. Proves PR #561 is NOT the cause (flag-OFF payload is
byte-identical pre/post #561) and pins the real defect to `b57a98e` (2026-04-18),
which made new-ad creatives page-only (no `instagram_actor_id`) → Instagram
placements rejected. Deliverable: `docs/AUDIT_DUAL_IMAGE_1772103_2026-06-05.md`
plus an intentionally-RED regression test.

## Scope / files

- `docs/AUDIT_DUAL_IMAGE_1772103_2026-06-05.md` — diagnosis memo with payload diff
- `lib/meta/__tests__/creative-ig-identity-regression.test.ts` — RED acceptance
  test (asserts new-ad creatives carry an IG identity when the draft has one)

## Method (ground truth)

- Built `buildCreativePayload` + `sanitizeCreativeForStrictMode` at `c91da5a`
  (pre-#561) and `ae77c92` (post-#561), flag OFF → identical `/adcreatives` JSON.
- Built single 9:16 vs dual 4:5+9:16 → structurally identical page-only specs.
- `git log -S` located the `instagram_actor_id` removal at `b57a98e`.

## Validation

- [x] Regression test confirmed RED on current main (both image + video fail:
  "instagram_actor_id = OMITTED").
- [x] No production code changed (diagnosis only).

## Notes / next step

- **CI will be red on this branch by design** — the regression test encodes the
  expected post-fix behaviour and is the acceptance gate for the follow-up fix PR.
- Fix decision required (in the memo): targeted re-add of a *validated*
  `instagram_actor_id` vs straight revert of `b57a98e` — trade-off is the original
  `#100` unauthorised-actor error that `b57a98e` was avoiding.
- The flag-ON `buildMultiPlacementCreative` path has the same page-only defect, so
  the fix must cover all new-ad builders.
