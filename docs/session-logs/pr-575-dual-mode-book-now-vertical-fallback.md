# Session log — BOOK_NOW + dual-mode vertical fallback

## PR

- **Number:** 575
- **URL:** 575
- **Branch:** `cursor/dual-mode-book-now-vertical-fallback`

## Summary

Implements the fix proposed by PR #574 audit: when a creative has both a 4:5 feed asset and a 9:16 vertical asset uploaded (dual/full asset mode) **and** the CTA is `BOOK_NOW`, the multi-placement `asset_feed_spec` path is bypassed. Instead the ad is built as a single-asset creative using the 9:16 vertical asset with `BOOK_NOW` in `link_data` / `video_data`. The 4:5 asset is intentionally not used. CTA is never substituted silently. A UI warning in the creatives step informs the user of the trade-off so they can consciously switch CTA if per-placement routing matters more.

This is a Meta platform constraint, not a wizard bug. `asset_feed_spec.call_to_action_types: ["BOOK_NOW"]` returns `subcode=1885396` for every objective (`OUTCOME_SALES`, `OUTCOME_TRAFFIC`, `OUTCOME_AWARENESS`) and every media type (image `SINGLE_IMAGE`, video `SINGLE_VIDEO`). Standard `link_data` / `video_data` with `BOOK_NOW` works fine. PR #574 proved this via `validate_only` + read-back on both image and video AFS.

## Scope / files

- `lib/meta/creative.ts` — `buildCreativePayload`: BOOK_NOW + dual gate; new private `buildSingleAssetFromVertical` helper
- `lib/meta/__tests__/creative-multi-placement.test.ts` — 6 new test cases (dual image/video + BOOK_NOW → vertical; LEARN_MORE regression; flag-off path); fixture helpers updated to accept `cta` param
- `components/steps/creatives.tsx` — inline amber warning below CTA dropdown when `book_now` + `dual`/`full` asset mode
- `app/api/meta/launch-campaign/route.ts` — preflight `console.error` warning when the BOOK_NOW vertical fallback fires; `bookNowVerticalFallback` added to phase-3 POSTing log

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files
- [x] `node --test lib/meta/__tests__/creative-multi-placement.test.ts` — 17/17 pass (6 new)

## Notes

- Non-negotiables honoured: CTA is never auto-substituted; 4:5 asset is never used in fallback; user's CTA/asset-mode selection unchanged.
- The vertical (9:16) asset cross-publishes more acceptably across placements than 4:5 — Stories/Reels get the native ratio; Feed auto-crops from the centre.
- Follow-up: post-merge, relaunch Aberdeen WC26-ABERDEEN traffic ads with BOOK_NOW + Dual mode. Expected: Vercel log shows the `BOOK_NOW blocked in AFS` message; preflight emits the ⚠ warning; ad uses 9:16 in all placements.
