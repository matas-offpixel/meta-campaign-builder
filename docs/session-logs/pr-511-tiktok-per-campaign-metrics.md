# Session log — fix(tiktok): per-campaign metric list

## PR

- **Number:** 511
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/511
- **Branch:** `cursor/tiktok-per-campaign-metrics`

## Summary

Fixed TikTok's `/v1.3/report/integrated/get/` API rejection of invalid metric fields for the Ironworks [IRWOHD] brand_campaign event. Root cause: PR #497 built a single broad `METRICS` list that included optimization-goal-specific conversion metrics (`complete_registration`, `add_to_cart`, etc.) and the deprecated `video_play` field (renamed to `video_play_actions` by TikTok). The API validates that every metric in the list is compatible with the advertiser's campaign objectives, so sending `add_to_cart` to an account running only LEAD_GENERATION campaigns fails the entire call. The fix fetches `/campaign/get/` first to learn each campaign's `optimization_goal`, groups matching campaigns by goal, then makes one `/report/integrated/get/` call per goal group with only the metrics valid for that goal.

## Scope / files

- `lib/tiktok/insights.ts` — rewrote metric strategy: new `BASE_METRICS` constant, `GOAL_EXTRA_METRICS` map, exported `buildMetricsForCampaign()`, refactored `fetchTikTokEventCampaignInsights` to call `/campaign/get/` first and make per-goal-group report calls
- `lib/tiktok/__tests__/insights-metric-build.test.ts` — **NEW** 19 tests covering `BASE_METRICS` invariants and `buildMetricsForCampaign` per-goal assertions; includes Ironworks scenario guard
- `lib/tiktok/__tests__/insights.test.ts` — added 3 regression tests: per-goal metric routing for COMPLETE_REGISTRATION, LEAD campaigns (Ironworks pattern), and separate calls for mixed-goal campaign sets

## Validation

- [x] `npx tsc --noEmit` — zero errors in `lib/tiktok/` (pre-existing errors in `.next/dev/` and `lib/audiences/__tests__/` unchanged)
- [x] `npm run build` — clean build
- [x] `npm test` — 2014/2021 pass (same 5 pre-existing failures, 0 new failures)

## Notes

- `breakdowns.ts` METRICS list was already clean — no conversion metrics, no `video_play` — no change needed there.
- The new per-goal-group architecture means campaigns with different objectives get separate API calls, each with only their valid metrics. Campaigns sharing the same goal (the common case) share one call.
- `video_play` → `video_play_actions` fix is part of `BASE_METRICS` and applies to ALL calls.
- `tiktok_breakdown_snapshots` was empty systemwide because the metric error in `insights.ts` caused the cron to fail silently — this unblocks those snapshots for every brand_campaign event (Black Butter, Ironworks, etc.).
