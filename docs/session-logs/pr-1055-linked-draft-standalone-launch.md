# Session log

## PR

- **Number:** 1055
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1055
- **Branch:** `cursor/linked-draft-standalone-launch`

## Summary

A plan link was hiding Review and Launch for every linked Meta draft. Attach drafts and already-published drafts had nowhere to launch, because the canvas only starts a new campaign, paused. The canvas now takes Launch only for an unpublished new campaign whose Meta row is still idle or failed. Every other linked draft launches from the creator. Review always renders.

A creator-owned launch does not write `campaign_plan_meta_launch` or recompute `campaign_plans.status`. `recordWizardMetaLaunch` uses the same `planOwnsLaunch` helper, with wizard mode and draft status read before the launch.

## Scope / files

- `lib/plan/linked-plan.ts` — `planOwnsLaunch`. Meta loader also returns `metaLaunchStatus`. The campaign page passes that summary into the shell; wizard mode and draft status are on the client draft, so the shell is the call site.
- `components/wizard/wizard-shell.tsx` — uses the helper for Review and the footer Launch button.
- `components/steps/review-launch.tsx` — when the canvas owns Launch, the review stays and the canvas pointer replaces the launch controls.
- `app/api/meta/launch-campaign/route.ts` — no refusal of a plan-linked draft. Both record calls pass `preLaunchPlanOwnership` (wizard mode and draft status from before publish).
- `lib/plan/record-wizard-launch.ts` — writes the plan row only when `planOwnsLaunch` is true. Otherwise logs `[plan-record] skipped: creator-owned launch` and leaves the plan alone.
- `lib/meta/__tests__/transient-retry.test.ts` — retry still re-enters `handleLaunch`, omitted only when the canvas owns Launch.

## Validation

- [x] `npm test` — 7301 pass, 0 fail, 4 skipped; vitest library rows 8 pass
- [x] `npx tsc --noEmit` — no new errors in touched files. `schedule-and-continuation.test.ts` still has the pre-existing duplicate `startTime`/`endTime` spread.
- [x] ESLint on touched files — clean except pre-existing unused-var warnings in `launch-campaign/route.ts` and `review-launch.tsx`
- [x] `npm run build` — succeeded with gitignored `scripts/out` set aside (same as CI), then restored.
- [ ] Screenshot of `/campaign/645ed600-6863-4175-af9a-2a7234b0e7b1` Review. Not captured: no signed-in browser in this session. Launch was not pressed.

## Notes

`"new"` is the new-campaign wizard mode. Migration 194 is unrelated and was not touched.
